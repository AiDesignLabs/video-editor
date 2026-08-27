import { dir as _dir, file as _file } from 'opfs-tools'
import { ensureResourceCached, getCachedResourceFile, waitForResourceDirectoryWrites, waitForResourceWrite } from './cache'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { fileTo, getResourceType } from './fetch'
import { getResourceOpfsPath, inferResourceTypeFromUrl } from './key'

export function createResourceManager(opts?: { dir?: string }) {
  const { dir = DEFAULT_RESOURCE_DIR } = opts || {}

  async function add(url: string, opts?: { body?: ReadableStream<BufferSource> }) {
    if (!url)
      return

    await ensureResourceCached(url, dir, opts)
  }

  async function exists(url: string) {
    if (!url)
      return false

    const path = getResourceOpfsPath(dir, url)
    if (!path)
      return false

    return Boolean(await getCachedResourceFile(url, dir))
  }

  async function get(url: string): Promise<unknown> {
    if (!(await exists(url)))
      return

    const inferred = inferResourceTypeFromUrl(url)
    const type = inferred ?? (await getResourceType(url).then(r => r.type).catch(() => undefined))
    if (!type)
      return

    const path = getResourceOpfsPath(dir, url)
    if (!path)
      return
    const file = _file(path)
    return fileTo(type)(file)
  }

  async function remove(url: string) {
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
  }
}

export { DEFAULT_RESOURCE_DIR } from './constants'
export { getResourceKey } from './key'
export { getMp4Meta } from './meta'
export { generateThumbnails } from './thumbnails'
export { clearWaveformCache, extractWaveform, extractWaveformFromBuffer, peaksToBars, peaksToSvgPath } from './waveform'
export type { WaveformData, WaveformOptions } from './waveform'
