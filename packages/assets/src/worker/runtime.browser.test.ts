/* eslint-disable style/max-statements-per-line */
import { createCacheKey } from '../cache/key'
import { openAssetDatabase } from '../storage/database'
import { AssetWorkerRuntime } from './runtime'

describe('assetWorkerRuntime browser cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the default fetch with the global receiver', async () => {
    const namespace = `browser-default-fetch-${crypto.randomUUID()}`
    const url = 'https://example.com/default-fetch'
    const body = 'default-fetch'
    const globalFetch = vi.fn(function (this: typeof globalThis, input: RequestInfo | URL) {
      expect(this).toBe(globalThis)
      expect(String(input)).toBe(url)
      return Promise.resolve(new Response(new Blob([body]), { headers: { 'content-length': String(body.length) } }))
    })
    vi.stubGlobal('fetch', globalFetch)

    const runtime = new AssetWorkerRuntime({ cacheNamespace: namespace })
    await runtime.initialize()
    await expect(runtime.ensureCached({ ref: { assetId: 'default-fetch', sourceRevision: 1, variantId: 'source' }, url }))
      .resolves
      .toMatchObject({ status: 'succeeded' })
    expect(globalFetch).toHaveBeenCalledOnce()
    runtime.close()
  })

  it('limits background downloads and prioritizes interactive work', async () => {
    const namespace = `browser-priority-${crypto.randomUUID()}`
    const started: string[] = []
    const finishByUrl = new Map<string, () => void>()
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      started.push(url)
      await new Promise<void>((resolve) => { finishByUrl.set(url, resolve) })
      return new Response(new Blob([url]), { headers: { 'content-length': String(url.length) } })
    })
    const runtime = new AssetWorkerRuntime({
      cacheNamespace: namespace,
      fetch: fetcher,
      maxConcurrentDownloads: 2,
      maxConcurrentBackgroundDownloads: 1,
    })
    await runtime.initialize()
    const backgroundOne = runtime.ensureCached({ ref: { assetId: 'background-1', sourceRevision: 1, variantId: 'source' }, url: 'https://example.com/background-1', priority: 'background' })
    const backgroundTwo = runtime.ensureCached({ ref: { assetId: 'background-2', sourceRevision: 1, variantId: 'source' }, url: 'https://example.com/background-2', priority: 'background' })
    await vi.waitFor(() => expect(started).toEqual(['https://example.com/background-1']))

    const interactive = runtime.ensureCached({ ref: { assetId: 'interactive', sourceRevision: 1, variantId: 'source' }, url: 'https://example.com/interactive', priority: 'interactive' })
    await vi.waitFor(() => expect(started).toEqual([
      'https://example.com/background-1',
      'https://example.com/interactive',
    ]))

    finishByUrl.get('https://example.com/interactive')?.()
    await interactive
    expect(started).toHaveLength(2)
    finishByUrl.get('https://example.com/background-1')?.()
    await backgroundOne
    await vi.waitFor(() => expect(started.at(-1)).toBe('https://example.com/background-2'))
    finishByUrl.get('https://example.com/background-2')?.()
    await backgroundTwo
    runtime.close()
  })

  it('stores an uploaded local file without downloading it again', async () => {
    const namespace = `browser-local-${crypto.randomUUID()}`
    const fetcher = vi.fn()
    const runtime = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher })
    await runtime.initialize()
    const now = Date.now()
    const asset = { assetId: 'uploaded-source', sourceRevision: 1, kind: 'video' as const, createdAt: now, updatedAt: now }
    const variant = { assetId: asset.assetId, sourceRevision: 1, variantId: 'source', remoteFileId: asset.assetId, remoteRecovery: 'host-refreshable' as const, contentType: 'video/mp4', createdAt: now, updatedAt: now }

    await expect(runtime.cacheLocal(asset, variant, new File(['local-source'], 'source.mp4', { type: 'video/mp4' })))
      .resolves
      .toMatchObject({ status: 'succeeded' })
    expect(fetcher).not.toHaveBeenCalled()
    const resolved = await runtime.resolve({ ref: variant })
    expect(resolved.source).toBe('opfs')
    if (resolved.source === 'opfs') {
      expect(await resolved.file.text()).toBe('local-source')
      runtime.release(resolved.leaseId)
    }
    runtime.close()
  })

  it('deduplicates a cache write across two worker runtimes', async () => {
    const namespace = `browser-dedupe-${crypto.randomUUID()}`
    let finishDownload: (() => void) | undefined
    const downloadGate = new Promise<void>((resolve) => { finishDownload = resolve })
    const fetcher = vi.fn(async () => {
      await downloadGate
      return new Response(new Blob(['shared']), { headers: { 'content-length': '6' } })
    })
    const first = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher })
    const second = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher })
    await Promise.all([first.initialize(), second.initialize()])
    const request = { ref: { assetId: 'asset', sourceRevision: 1, variantId: 'source' }, url: 'https://example.com/shared' }
    const firstWrite = first.ensureCached(request)
    const secondWrite = second.ensureCached(request)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetcher).toHaveBeenCalledOnce()
    finishDownload?.()
    await expect(Promise.all([firstWrite, secondWrite])).resolves.toEqual([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({ status: 'succeeded' }),
    ])
    expect(fetcher).toHaveBeenCalledOnce()
    first.close()
    second.close()
  })

  it('renews a writer lease while a long download is still running', async () => {
    const namespace = `browser-renew-${crypto.randomUUID()}`
    let finishDownload: (() => void) | undefined
    const downloadGate = new Promise<void>((resolve) => { finishDownload = resolve })
    const fetcher = vi.fn(async () => {
      await downloadGate
      return new Response(new Blob(['renewed']), { headers: { 'content-length': '7' } })
    })
    const first = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher, writerLeaseMs: 120 })
    const second = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher, writerLeaseMs: 120 })
    await Promise.all([first.initialize(), second.initialize()])
    const request = { ref: { assetId: 'renewed-asset', sourceRevision: 1, variantId: 'source' }, url: 'https://example.com/renewed' }
    const cacheKey = await createCacheKey(namespace, request.ref)
    const firstWrite = first.ensureCached(request)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())

    const database = await openAssetDatabase()
    const initialLeaseUntil = (await database.get('cacheEntries', cacheKey))?.writerLeaseUntil
    expect(initialLeaseUntil).toBeTypeOf('number')
    await vi.waitFor(async () => {
      const renewedLeaseUntil = (await database.get('cacheEntries', cacheKey))?.writerLeaseUntil
      expect(renewedLeaseUntil).toBeGreaterThan(initialLeaseUntil ?? 0)
    })

    const secondWrite = second.ensureCached(request)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetcher).toHaveBeenCalledOnce()
    finishDownload?.()
    await expect(Promise.all([firstWrite, secondWrite])).resolves.toEqual([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({ status: 'succeeded' }),
    ])
    database.close()
    first.close()
    second.close()
  })

  it('does not overwrite or remove the winner when ownership changes before commit', async () => {
    const namespace = `browser-ownership-${crypto.randomUUID()}`
    let finishDownload: (() => void) | undefined
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        finishDownload = () => {
          controller.enqueue(new TextEncoder().encode('loser'))
          controller.close()
        }
      },
    }), { headers: { 'content-length': '5' } }))
    const first = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher })
    const second = new AssetWorkerRuntime({ cacheNamespace: namespace, fetch: fetcher })
    await Promise.all([first.initialize(), second.initialize()])
    const ref = { assetId: 'ownership-asset', sourceRevision: 1, variantId: 'source' }
    const cacheKey = await createCacheKey(namespace, ref)
    const firstOutcome = first.ensureCached({ ref, url: 'https://example.com/loser' })
      .then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
    await vi.waitFor(async () => expect(await first.getCacheStatus(ref)).toMatchObject({ status: 'writing' }))

    const database = await openAssetDatabase()
    const firstEntry = await database.get('cacheEntries', cacheKey)
    expect(firstEntry).toBeDefined()
    await database.put('cacheEntries', { ...firstEntry!, writerLeaseUntil: Date.now() - 1 })

    const now = Date.now()
    const asset = { assetId: ref.assetId, sourceRevision: ref.sourceRevision, kind: 'video' as const, createdAt: now, updatedAt: now }
    const variant = { ...ref, remoteFileId: ref.assetId, remoteRecovery: 'host-refreshable' as const, contentType: 'video/mp4', createdAt: now, updatedAt: now }
    await expect(second.cacheLocal(asset, variant, new File(['winner'], 'winner.mp4', { type: 'video/mp4' })))
      .resolves
      .toMatchObject({ status: 'succeeded' })

    finishDownload?.()
    const lostWriter = await firstOutcome
    expect(lostWriter.value).toBeUndefined()
    expect(lostWriter.error).toBeInstanceOf(Error)
    expect(String(lostWriter.error)).toContain('lost ownership before commit')
    await expect(second.getCacheStatus(ref)).resolves.toMatchObject({ status: 'ready', sizeBytes: 6 })
    const resolved = await second.resolve({ ref })
    expect(resolved.source).toBe('opfs')
    if (resolved.source === 'opfs') {
      expect(await resolved.file.text()).toBe('winner')
      second.release(resolved.leaseId)
    }
    database.close()
    first.close()
    second.close()
  })

  it('returns the URL immediately, then resolves an OPFS file after caching', async () => {
    const namespace = `browser-${crypto.randomUUID()}`
    const runtime = new AssetWorkerRuntime({
      cacheNamespace: namespace,
      fetch: async () => new Response(new Blob(['cached-video'], { type: 'video/mp4' }), { headers: { 'content-length': '12' } }),
    })
    await runtime.initialize()
    const ref = { assetId: 'asset-1', sourceRevision: 1, variantId: 'source' }
    const now = Date.now()
    await runtime.upsertAsset(
      { ...ref, kind: 'video', name: 'clip.mp4', createdAt: now, updatedAt: now },
      [{ ...ref, remoteRecovery: 'host-refreshable', contentType: 'video/mp4', sizeBytes: 12, createdAt: now, updatedAt: now }],
    )

    await expect(runtime.resolve({ ref, fallbackUrl: 'https://example.com/clip.mp4', cacheOnMiss: false }))
      .resolves
      .toEqual({ source: 'url', url: 'https://example.com/clip.mp4' })
    await expect(runtime.ensureCached({ ref, url: 'https://example.com/clip.mp4' })).resolves.toMatchObject({ status: 'succeeded' })
    const resolved = await runtime.resolve({ ref })
    expect(resolved.source).toBe('opfs')
    if (resolved.source === 'opfs') {
      expect(resolved.file.type).toBe('video/mp4')
      expect(await resolved.file.text()).toBe('cached-video')
      runtime.release(resolved.leaseId)
    }
    await expect(runtime.clearCache()).resolves.toMatchObject({ reason: 'explicit', removedEntries: 0, retainedLeaseEntries: 1 })
    runtime.close()
  })
})
