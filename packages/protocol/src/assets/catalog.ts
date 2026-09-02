import type { IVideoProtocol } from '@video-editor/shared'
import type { AssetKind, AssetLibrary, AssetLibraryOptions, AssetMeta } from './index'
import { createAssetLibrary } from './index'

export type MediaAssetProxyStatus = 'none' | 'ready' | 'stale'

/** User-facing media metadata. Storage locations and derived asset ids stay private. */
export interface MediaAsset {
  id: string
  name: string
  kind: AssetKind
  sizeBytes: number
  createdAt: number
  durationMs?: number
  width?: number
  height?: number
  proxyStatus: MediaAssetProxyStatus
}

/** Compatibility fields required when a managed asset is written into a segment. */
export interface SegmentAssetBinding {
  assetId: string
  url: string
  kind: AssetKind
  durationMs?: number
  width?: number
  height?: number
}

export interface MediaAssetCatalogOptions extends AssetLibraryOptions {
  /** Reuse an advanced asset library, primarily for custom storage or proxy generation. */
  library?: AssetLibrary
  /** Required by remove() so referenced media cannot be deleted. */
  getProtectedProtocols?: () => readonly IVideoProtocol[] | Promise<readonly IVideoProtocol[]>
}

export interface MediaAssetCatalog {
  import: (file: File) => Promise<MediaAsset>
  list: () => Promise<MediaAsset[]>
  get: (id: string) => Promise<MediaAsset | undefined>
  bindForSegment: (id: string) => Promise<SegmentAssetBinding>
  resolveForPreview: (id: string) => Promise<string | undefined>
  resolveForExport: (id: string) => Promise<string | undefined>
  remove: (id: string) => Promise<void>
}

function getProxyStatus(asset: AssetMeta, assets: readonly AssetMeta[]): MediaAssetProxyStatus {
  const proxies = assets.filter(candidate => candidate.derivation?.sourceAssetId === asset.id)
  if (!proxies.length)
    return 'none'
  return proxies.some(proxy => proxy.derivation?.sourceRevision === (asset.revision ?? 1))
    ? 'ready'
    : 'stale'
}

function toMediaAsset(asset: AssetMeta, assets: readonly AssetMeta[]): MediaAsset {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
    durationMs: asset.durationMs,
    width: asset.width,
    height: asset.height,
    proxyStatus: getProxyStatus(asset, assets),
  }
}

/** Public media catalog that keeps storage, URL, proxy, and OPFS details internal. */
export function createMediaAssetCatalog(options: MediaAssetCatalogOptions = {}): MediaAssetCatalog {
  const library = options.library ?? createAssetLibrary(options)

  async function listOriginals() {
    return (await library.listAssets()).filter(asset => !asset.derivation)
  }

  async function list(): Promise<MediaAsset[]> {
    const assets = await library.listAssets()
    return assets
      .filter(asset => !asset.derivation)
      .map(asset => toMediaAsset(asset, assets))
  }

  async function get(id: string): Promise<MediaAsset | undefined> {
    const assets = await library.listAssets()
    const asset = assets.find(candidate => candidate.id === id && !candidate.derivation)
    return asset ? toMediaAsset(asset, assets) : undefined
  }

  async function importAsset(file: File): Promise<MediaAsset> {
    const asset = await library.importAsset(file)
    return toMediaAsset(asset, [asset])
  }

  async function bindForSegment(id: string): Promise<SegmentAssetBinding> {
    const asset = (await listOriginals()).find(candidate => candidate.id === id)
    if (!asset)
      throw new Error(`No media asset with id ${id}`)
    return {
      assetId: asset.id,
      url: asset.url,
      kind: asset.kind,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
    }
  }

  async function remove(id: string): Promise<void> {
    if (!options.getProtectedProtocols)
      throw new Error('Media asset removal requires getProtectedProtocols')
    const protocols = await options.getProtectedProtocols()
    await library.removeAsset(id, { protocols, removeDerivatives: true })
  }

  return {
    import: importAsset,
    list,
    get,
    bindForSegment,
    resolveForPreview: id => library.resolveAssetUrl(id, { preferProxy: true }),
    resolveForExport: id => library.resolveAssetUrl(id),
    remove,
  }
}
