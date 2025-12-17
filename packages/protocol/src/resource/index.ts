import { dir as _dir, file as _file, write as _write } from 'opfs-tools'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { fileTo, getResourceType } from './fetch'
import { getResourceOpfsPath, inferResourceTypeFromUrl } from './key'

export function createResourceManager(opts?: { dir?: string }) {
  const { dir = DEFAULT_RESOURCE_DIR } = opts || {}
  const inflightByPath = new Map<string, Promise<void>>()

  async function add(url: string, opts?: { body?: ReadableStream<BufferSource> }) {
    if (!url)
      return

    const path = getResourceOpfsPath(dir, url)
    if (!path)
      return

    const inflight = inflightByPath.get(path)
    if (inflight) {
      opts?.body?.cancel?.().catch(() => {})
      return inflight
    }

    const job = (async () => {
      const file = _file(path)
      if (await file.exists()) {
        opts?.body?.cancel?.().catch(() => {})
        return
      }

      const body = opts?.body ?? (await fetch(url)).body
      if (!body)
        throw new Error('Resource not found')

      await _write(path, body, { overwrite: true })
    })()

    inflightByPath.set(path, job)
    try {
      await job
    }
    finally {
      inflightByPath.delete(path)
    }
  }

  async function exists(url: string) {
    if (!url)
      return false

    const path = getResourceOpfsPath(dir, url)
    if (!path)
      return false

    const inflight = inflightByPath.get(path)
    if (inflight) {
      try {
        await inflight
      }
      catch {
        // ignore inflight failures; fall back to filesystem check
      }
    }

    return await _file(path).exists()
  }

  async function get(url: string) {
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

    const inflight = inflightByPath.get(path)
    if (inflight) {
      try {
        await inflight
      }
      catch {
        // ignore inflight failures; proceed to cleanup
      }
    }

    const file = _file(path)
    if (!(await file.exists()))
      return

    await file.remove()
  }

  async function clear() {
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
export { generateThumbnails } from './thumbnails'
export { getMp4Meta } from './meta'
export { getResourceKey } from './key'
