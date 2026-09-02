import type { IVideoProtocol } from '@video-editor/shared'
import type { GenerateThumbnailsOptions, Thumbnail } from '../resource/thumbnails'
import type { WaveformData, WaveformOptions } from '../resource/waveform'
import type { AssetKind, AssetLibrary, AssetMeta } from './index'
import { generateThumbnails } from '../resource/thumbnails'
import { extractWaveform } from '../resource/waveform'
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
  name: string
  url: string
  kind: AssetKind
  durationMs?: number
  width?: number
  height?: number
}

export interface MediaAssetCatalogOptions {
  /** OPFS directory holding source media. */
  resourceDir?: string
  /** OPFS directory holding catalog metadata. */
  manifestDir?: string
  /** Required by remove() so referenced media cannot be deleted. */
  getProtectedProtocols?: () => readonly IVideoProtocol[] | Promise<readonly IVideoProtocol[]>
}

export interface MediaAssetCatalog {
  import: (file: File) => Promise<MediaAsset>
  list: () => Promise<MediaAsset[]>
  get: (id: string) => Promise<MediaAsset | undefined>
  bindForSegment: (id: string) => Promise<SegmentAssetBinding>
  getPreviewBlob: (id: string) => Promise<Blob | undefined>
  getThumbnails: (id: string, options?: GenerateThumbnailsOptions) => Promise<Thumbnail[]>
  getWaveform: (id: string, options?: WaveformOptions) => Promise<WaveformData>
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
  return createMediaAssetCatalogFromLibrary(createAssetLibrary(options), options)
}

/** Internal dependency-injection entry used by focused tests. */
export function createMediaAssetCatalogFromLibrary(
  library: AssetLibrary,
  options: Pick<MediaAssetCatalogOptions, 'getProtectedProtocols'> = {},
): MediaAssetCatalog {
  async function listOriginals() {
    return (await library.listAssets()).filter(asset => !asset.derivation)
  }

  async function requireOriginal(id: string): Promise<AssetMeta> {
    const asset = (await listOriginals()).find(candidate => candidate.id === id)
    if (!asset)
      throw new Error(`No media asset with id ${id}`)
    return asset
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
    const asset = await requireOriginal(id)
    return {
      assetId: asset.id,
      name: asset.name,
      url: asset.url,
      kind: asset.kind,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
    }
  }

  async function getPreviewBlob(id: string): Promise<Blob | undefined> {
    await requireOriginal(id)
    return await library.getAssetFile(id, { preferProxy: true })
  }

  async function getThumbnails(id: string, options?: GenerateThumbnailsOptions): Promise<Thumbnail[]> {
    const asset = await requireOriginal(id)
    if (asset.kind !== 'video')
      throw new Error(`Media asset ${id} is not a video`)
    const url = await library.resolveAssetUrl(id, { preferProxy: true })
    if (!url)
      throw new Error(`No preview source for media asset ${id}`)
    return await generateThumbnails(url, options)
  }

  async function getWaveform(id: string, options?: WaveformOptions): Promise<WaveformData> {
    const asset = await requireOriginal(id)
    if (asset.kind !== 'video' && asset.kind !== 'audio')
      throw new Error(`Media asset ${id} has no audio waveform`)
    return await extractWaveform(asset.url, options)
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
    getPreviewBlob,
    getThumbnails,
    getWaveform,
    resolveForPreview: id => library.resolveAssetUrl(id, { preferProxy: true }),
    resolveForExport: id => library.resolveAssetUrl(id),
    remove,
  }
}
