export interface CachedResourceFile {
  getOriginFile: () => Promise<File | undefined>
  release?: () => void
}

export interface ResourceCacheAdapter {
  get: (url: string) => Promise<CachedResourceFile | undefined>
  ensure: (url: string) => Promise<void>
  remove: (url: string) => Promise<void>
  clear: () => Promise<void>
}

// Protocol can be bundled into both the renderer and UI packages.
const adapterKey = Symbol.for('video-editor.resource-cache-adapter')
type ResourceGlobal = typeof globalThis & { [adapterKey]?: ResourceCacheAdapter }

export function installResourceCacheAdapter(adapter: ResourceCacheAdapter): () => void {
  const scope = globalThis as ResourceGlobal
  if (scope[adapterKey])
    throw new Error('A resource cache adapter is already installed.')
  scope[adapterKey] = adapter
  return () => {
    if (scope[adapterKey] === adapter)
      delete scope[adapterKey]
  }
}

export function getResourceCacheAdapter() {
  return (globalThis as ResourceGlobal)[adapterKey]
}
