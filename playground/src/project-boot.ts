import type { IVideoProtocol } from '@video-editor/shared'

/**
 * Synchronous boot cache for the playground.
 *
 * Projects are stored in OPFS through `createProjectStore()`, which is
 * async-only. The editor core, however, is created synchronously at module
 * setup and `editor-core` exposes no bulk "replace protocol" command, so the
 * protocol a session starts with has to be known before the first await.
 *
 * The playground therefore mirrors the active project into `localStorage` on
 * every save and reads it back here, before `createEditorCore()` runs. OPFS
 * remains the durable, multi-project source of truth; this cache only decides
 * which protocol the page boots into (and lets project switching work by
 * writing the cache and reloading).
 */
export const BOOT_CACHE_KEY = 've-playground-last-protocol'

export interface BootCache {
  id: string
  name: string
  protocol: IVideoProtocol
}

function isBootCache(value: unknown): value is BootCache {
  if (!value || typeof value !== 'object')
    return false
  const cache = value as Partial<BootCache>
  return typeof cache.id === 'string'
    && typeof cache.name === 'string'
    && !!cache.protocol
    && typeof cache.protocol === 'object'
}

/** Returns the cached project, or `null` when absent / unparseable. */
export function readBootCache(): BootCache | null {
  try {
    const raw = localStorage.getItem(BOOT_CACHE_KEY)
    if (!raw)
      return null
    const parsed: unknown = JSON.parse(raw)
    return isBootCache(parsed) ? parsed : null
  }
  catch {
    // A blocked or corrupted storage must never break the boot path.
    return null
  }
}

export function writeBootCache(cache: BootCache) {
  try {
    localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(cache))
  }
  catch (error) {
    console.error('[playground] failed to write the boot cache', error)
  }
}

export function clearBootCache() {
  try {
    localStorage.removeItem(BOOT_CACHE_KEY)
  }
  catch (error) {
    console.error('[playground] failed to clear the boot cache', error)
  }
}
