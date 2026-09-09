import { describe, expect, it, vi } from 'vitest'
import { createAssetFileStore } from '../storage/asset-file-store'
import { AssetWorkerRuntime } from './runtime'

describe('legacy media cache migration', () => {
  it.each(['complete', 'truncated', 'partial', 'transformed'] as const)('handles %s legacy files without accepting incomplete media', async (mode) => {
    const id = crypto.randomUUID()
    const directory = `/legacy-test-${id}`
    const path = `${directory}/https/example.com/video.mov`
    const files = createAssetFileStore()
    const body = 'complete-video'
    const oldPath = mode === 'partial' ? `${path}.partial-old` : path
    await files.writeTemporary(oldPath, new Blob([mode === 'truncated' ? 'short' : body]).stream())
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body))
    const runtime = new AssetWorkerRuntime({ cacheNamespace: id, legacyResourceDirectory: directory, fetch: fetcher })
    await runtime.initialize()
    const ref = { assetId: id, sourceRevision: 1, variantId: 'source' }
    try {
      await runtime.upsertAsset({ ...ref, kind: 'video', createdAt: 1, updatedAt: 1 }, [{ ...ref, remoteRecovery: 'host-refreshable', sizeBytes: body.length, createdAt: 1, updatedAt: 1 }])
      await runtime.ensureCached({ ref, url: `https://example.com/video.mov${mode === 'transformed' ? '?x-oss-process=video' : '?Expires=123&Signature=test'}` })
      expect(fetcher).toHaveBeenCalledTimes(mode === 'complete' ? 0 : 1)
      const resolved = await runtime.resolve({ ref, cacheOnMiss: false })
      expect(resolved.source).toBe('opfs')
      if (resolved.source !== 'opfs')
        throw new Error('Expected migrated media')
      expect(await resolved.file.text()).toBe(body)
      expect(Boolean(await files.read(oldPath, 'legacy'))).toBe(mode !== 'complete')
      runtime.release(resolved.leaseId)
    }
    finally {
      await files.remove(oldPath)
      await runtime.clearCache()
      runtime.close()
    }
  })

  it('evicts only the requested unleased asset', async () => {
    const runtime = new AssetWorkerRuntime({ cacheNamespace: crypto.randomUUID(), fetch: async () => new Response('test') })
    await runtime.initialize()
    const refs = ['one', 'two'].map(assetId => ({ assetId, sourceRevision: 1, variantId: 'source' }))
    try {
      for (const ref of refs)
        await runtime.ensureCached({ ref, url: 'https://example.com/video.mp4' })
      expect((await runtime.evict(refs[0]!)).removedEntries).toBe(1)
      expect((await runtime.getCacheStatus(refs[0]!)).status).toBe('not-cached')
      expect((await runtime.getCacheStatus(refs[1]!)).status).toBe('ready')
    }
    finally {
      await runtime.clearCache()
      runtime.close()
    }
  })
})
