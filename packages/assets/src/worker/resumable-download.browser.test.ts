import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCacheKey } from '../cache/key'
import { createAssetFileStore } from '../storage/asset-file-store'
import { openAssetDatabase } from '../storage/database'
import { AssetWorkerRuntime } from './runtime'

const runtimes: AssetWorkerRuntime[] = []
afterEach(() => {
  for (const runtime of runtimes.splice(0))
    runtime.close()
})

function rangeResponse(body: string, start: number, end: number, etag = '"v1"') {
  const bytes = body.slice(start, end + 1)
  return new Response(bytes, { status: 206, headers: {
    'Content-Range': `bytes ${start}-${end}/${body.length}`,
    'Content-Length': String(bytes.length),
    'ETag': etag,
  } })
}

async function createFixture() {
  const namespace = `resume-${crypto.randomUUID()}`
  const ref = { assetId: 'large-video', sourceRevision: 1, variantId: 'source' }
  const requests: Headers[] = []
  let handler: (headers: Headers) => Response | Promise<Response> = (headers) => {
    const start = Number(headers.get('range')!.match(/bytes=(\d+)/)![1])
    if (start > 0)
      throw new Error('Connection interrupted')
    return rangeResponse('abcdefghijkl', 0, 3)
  }
  const fetcher: typeof fetch = vi.fn(async (_input, init) => {
    const headers = new Headers(init?.headers)
    requests.push(headers)
    return await handler(headers)
  })
  const open = async () => {
    const runtime = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher, downloadChunkSizeBytes: 4 })
    runtimes.push(runtime)
    await runtime.initialize()
    return runtime
  }
  const runtime = await open()
  const request = { ref, url: 'https://example.com/video.mov?signature=old' }
  await expect(runtime.ensureCached(request)).rejects.toThrow('Connection interrupted')
  expect(await runtime.getCacheStatus(ref)).toMatchObject({ status: 'failed', downloadedBytes: 4, totalBytes: 12 })
  await expect(runtime.resolve({ ref, fallbackUrl: request.url, cacheOnMiss: false })).resolves.toMatchObject({ source: 'url' })
  const database = await openAssetDatabase()
  const cacheKey = await createCacheKey(namespace, ref)
  const checkpoint = (await database.get('cacheEntries', cacheKey))!
  database.close()
  runtime.close()
  function handle(next: typeof handler) {
    handler = next
  }
  return { namespace, ref, request, requests, checkpoint, cacheKey, open, handle }
}

describe('persistent ranged downloads', () => {
  it('restarts from zero when a persisted chunk is missing', async () => {
    const fixture = await createFixture()
    await createAssetFileStore().remove(fixture.checkpoint.download!.chunks[0]!.path)
    fixture.handle((headers) => {
      const start = Number(headers.get('range')!.match(/bytes=(\d+)/)![1])
      return rangeResponse('abcdefghijkl', start, Math.min(start + 3, 11))
    })
    const reopened = await fixture.open()
    await reopened.ensureCached(fixture.request)
    expect(fixture.requests.slice(2).map(headers => headers.get('range'))).toEqual(['bytes=0-3', 'bytes=4-7', 'bytes=8-11'])
  })

  it('recovers from 416 when the remote object has become shorter', async () => {
    const fixture = await createFixture()
    fixture.handle(headers => headers.get('range') === 'bytes=4-7'
      ? new Response(null, { status: 416 })
      : rangeResponse('xyz', 0, 2, '"v2"'))
    const reopened = await fixture.open()
    await reopened.ensureCached(fixture.request)
    const resolved = await reopened.resolve({ ref: fixture.ref })
    expect(resolved.source === 'opfs' && await resolved.file.text()).toBe('xyz')
  })
  it('retries transient failures from the last completed chunk', async () => {
    const fixture = await createFixture()
    let interrupted = false
    fixture.handle((headers) => {
      if (!interrupted) {
        interrupted = true
        throw new TypeError('Network disconnected')
      }
      const start = Number(headers.get('range')!.match(/bytes=(\d+)/)![1])
      return rangeResponse('abcdefghijkl', start, Math.min(start + 3, 11))
    })
    const reopened = await fixture.open()
    await reopened.ensureCached(fixture.request)
    expect(fixture.requests.slice(2).map(headers => headers.get('range'))).toEqual(['bytes=4-7', 'bytes=4-7', 'bytes=8-11'])
  })

  it('uses a full download if the server does not expose range headers', async () => {
    const fixture = await createFixture()
    fixture.handle(headers => headers.has('range')
      ? new Response('efgh', { status: 206, headers: { ETag: '"v1"' } })
      : new Response('abcdefghijkl', { headers: { 'Content-Length': '12' } }))
    const reopened = await fixture.open()
    await reopened.ensureCached(fixture.request)
    const resolved = await reopened.resolve({ ref: fixture.ref })
    expect(resolved.source === 'opfs' && await resolved.file.text()).toBe('abcdefghijkl')
    expect(fixture.requests.at(-1)?.has('range')).toBe(false)
  })

  it('shares the resumed writer across runtime instances', async () => {
    const fixture = await createFixture()
    fixture.handle((headers) => {
      const start = Number(headers.get('range')!.match(/bytes=(\d+)/)![1])
      return rangeResponse('abcdefghijkl', start, Math.min(start + 3, 11))
    })
    const first = await fixture.open()
    const second = await fixture.open()
    await Promise.all([first.ensureCached(fixture.request), second.ensureCached(fixture.request)])
    expect(fixture.requests.slice(2).map(headers => headers.get('range'))).toEqual(['bytes=4-7', 'bytes=8-11'])
  })
  it('resumes after reopening with a refreshed URL and never returns partial media', async () => {
    const fixture = await createFixture()
    const previousRequests = fixture.requests.length
    fixture.handle((headers) => {
      expect(headers.get('if-range')).toBe('"v1"')
      const start = Number(headers.get('range')!.match(/bytes=(\d+)/)![1])
      return rangeResponse('abcdefghijkl', start, Math.min(start + 3, 11))
    })
    const reopened = await fixture.open()
    await reopened.ensureCached({ ...fixture.request, url: 'https://example.com/video.mov?signature=renewed' })
    expect(fixture.requests.slice(previousRequests).map(headers => headers.get('range'))).toEqual(['bytes=4-7', 'bytes=8-11'])
    const resolved = await reopened.resolve({ ref: fixture.ref })
    if (resolved.source !== 'opfs')
      throw new Error('Expected a completed OPFS file')
    expect(await resolved.file.text()).toBe('abcdefghijkl')
    expect(await reopened.getCacheStatus(fixture.ref)).toMatchObject({ status: 'ready', downloadedBytes: 12, totalBytes: 12 })
    const files = createAssetFileStore()
    expect(await files.read(fixture.checkpoint.download!.chunks[0]!.path, 'chunk')).toBeUndefined()
  })

  it('recovers an expired writer and retains committed chunks during scheduled cleanup', async () => {
    const fixture = await createFixture()
    const database = await openAssetDatabase()
    await database.put('cacheEntries', { ...fixture.checkpoint, status: 'writing', writerLeaseUntil: 0 })
    database.close()
    const reopened = await fixture.open()
    expect(await reopened.getCacheStatus(fixture.ref)).toMatchObject({ failureCode: 'ASSET_JOB_INTERRUPTED', downloadedBytes: 4 })
    await reopened.sweep()
    expect(await reopened.getCacheStatus(fixture.ref)).toMatchObject({ downloadedBytes: 4 })
    await reopened.clearCache()
    expect(await reopened.getCacheStatus(fixture.ref)).toMatchObject({ status: 'not-cached' })
    expect(await createAssetFileStore().read(fixture.checkpoint.download!.chunks[0]!.path, 'chunk')).toBeUndefined()
  })

  it('restarts cleanly when If-Range returns a full changed representation', async () => {
    const fixture = await createFixture()
    fixture.handle(() => new Response('NEW-CONTENT', { headers: { 'Content-Length': '11' } }))
    const reopened = await fixture.open()
    await reopened.ensureCached(fixture.request)
    const resolved = await reopened.resolve({ ref: fixture.ref })
    expect(resolved.source === 'opfs' && await resolved.file.text()).toBe('NEW-CONTENT')
  })

  it('rejects incorrect ranges without corrupting the existing checkpoint', async () => {
    const fixture = await createFixture()
    fixture.handle(() => rangeResponse('abcdefghijkl', 0, 3))
    const reopened = await fixture.open()
    await expect(reopened.ensureCached(fixture.request)).rejects.toThrow('Invalid Content-Range')
    expect(await reopened.getCacheStatus(fixture.ref)).toMatchObject({ status: 'failed', downloadedBytes: 4 })
  })

  it('does not keep a truncated chunk and resumes again at its original offset', async () => {
    const fixture = await createFixture()
    fixture.handle(() => new Response('ef', { status: 206, headers: {
      'Content-Range': 'bytes 4-7/12',
      'ETag': '"v1"',
    } }))
    const reopened = await fixture.open()
    await expect(reopened.ensureCached(fixture.request)).rejects.toThrow('size mismatch')
    expect(await reopened.getCacheStatus(fixture.ref)).toMatchObject({ downloadedBytes: 4 })
  })

  it('discards old chunks if the server returns a different ETag with 206', async () => {
    const fixture = await createFixture()
    fixture.handle((headers) => {
      const start = Number(headers.get('range')!.match(/bytes=(\d+)/)![1])
      return rangeResponse('0123456789ab', start, Math.min(start + 3, 11), '"v2"')
    })
    const reopened = await fixture.open()
    await reopened.ensureCached(fixture.request)
    const resolved = await reopened.resolve({ ref: fixture.ref })
    expect(resolved.source === 'opfs' && await resolved.file.text()).toBe('0123456789ab')
    expect(fixture.requests.slice(2).map(headers => headers.get('range'))).toEqual(['bytes=4-7', 'bytes=0-3', 'bytes=4-7', 'bytes=8-11'])
  })
})
