import { file as opfsFile } from 'opfs-tools'
import { describe, expect, it, vi } from 'vitest'
import { installResourceCacheAdapter } from './adapter'
import { getCachedResourceFile } from './cache'
import { createResourceManager } from './index'
import { getResourceOpfsPath } from './key'

describe('host-owned resource cache', () => {
  it('routes remote reads, writes and removal through the same adapter', async () => {
    const url = `https://example.com/${crypto.randomUUID()}.mp4`
    const directory = `/adapter-test-${crypto.randomUUID()}`
    const native = new File(['cached'], 'video.mp4')
    const cached = { getOriginFile: async () => native, release: vi.fn() }
    const adapter = { get: vi.fn(async () => cached), ensure: vi.fn(async () => {}), remove: vi.fn(async () => {}), clear: vi.fn(async () => {}) }
    const uninstall = installResourceCacheAdapter(adapter)
    try {
      const manager = createResourceManager({ dir: directory })
      await manager.add(url)
      expect(adapter.ensure).toHaveBeenCalledWith(url)
      expect(await opfsFile(getResourceOpfsPath(directory, url)).exists()).toBe(false)
      expect(await getCachedResourceFile(url, directory)).toBe(cached)
      expect(await (await manager.getFile(url))?.getOriginFile()).toBe(native)
      await manager.remove(url)
      expect(adapter.remove).toHaveBeenCalledWith(url)
      await manager.clear()
      expect(adapter.clear).toHaveBeenCalledOnce()
    }
    finally {
      uninstall()
    }
    expect(await getCachedResourceFile(url, directory)).toBeUndefined()
  })
})
