import { dir as _dir, file as _file } from 'opfs-tools'
import { getResourceCacheAdapter } from './adapter'
import { ensureResourceCached, getCachedResourceFile, waitForResourceDirectoryWrites, waitForResourceWrite } from './cache'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { fileTo, getResourceType } from './fetch'
import { getResourceOpfsPath, inferResourceTypeFromUrl } from './key'
import { clearMp4MetaCache } from './meta'
import { clearThumbnailCache } from './thumbnails'
import { clearWaveformCache } from './waveform'

export async function invalidateResourceDerivatives(url: string, resourceDir = DEFAULT_RESOURCE_DIR): Promise<void> {
  if (!url)
    return
  clearMp4MetaCache(url, resourceDir)
  clearWaveformCache(url, resourceDir)
  await clearThumbnailCache(url, resourceDir)
}

export function createResourceManager(opts?: { dir?: string }) {
  const { dir = DEFAULT_RESOURCE_DIR } = opts || {}

  async function add(url: string, opts?: { body?: ReadableStream<BufferSource> }) {
    if (!url)
      return

    await ensureResourceCached(url, dir, opts)
  }

  async function get(url: string): Promise<unknown> {
    const file = await getCachedResourceFile(url, dir)
    if (!file)
      return
    try {
      const inferred = inferResourceTypeFromUrl(url)
      const type = inferred ?? (await getResourceType(url).then(r => r.type).catch(() => undefined))
      if (!type)
        return

      return await fileTo(type)(file)
    }
    finally {
      file.release?.()
    }
  }

  async function remove(url: string) {
    const adapter = /^https?:\/\//i.test(url) && getResourceCacheAdapter()
    if (adapter)
      return await adapter.remove(url)
    if (!url)
      return

    const path = getResourceOpfsPath(dir, url)
    if (!path)
      return

    await waitForResourceWrite(path)

    const file = _file(path)
    if (!(await file.exists()))
      return

    await file.remove()
  }

  async function clear() {
    const adapter = getResourceCacheAdapter()
    if (adapter)
      await adapter.clear()
    await waitForResourceDirectoryWrites(dir)
    if (!(await _dir(dir).exists()))
      return

    await _dir(dir).remove()
  }

  return {
    add,
    get,
    remove,
    clear,
    getFile: (url: string) => getCachedResourceFile(url, dir),
  }
}

export { installResourceCacheAdapter } from './adapter'
export type { CachedResourceFile, ResourceCacheAdapter } from './adapter'
export { DEFAULT_RESOURCE_DIR } from './constants'
export { getResourceKey } from './key'
export { clearMp4MetaCache, getMp4Meta } from './meta'
export { clearThumbnailCache, generateThumbnails } from './thumbnails'
export type { GenerateThumbnailsOptions, Thumbnail } from './thumbnails'
export { clearWaveformCache, extractWaveform, extractWaveformFromBuffer, peaksToBars, peaksToSvgPath } from './waveform'
export type { WaveformData, WaveformOptions } from './waveform'
