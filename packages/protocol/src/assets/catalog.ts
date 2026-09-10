import type { AssetService, AssetUrlHandle } from '@video-editor/assets'
import type { IVideoProtocol } from '@video-editor/shared'
import type { GenerateThumbnailsOptions, Thumbnail } from '../resource/thumbnails'
import type { WaveformData, WaveformOptions } from '../resource/waveform'
import type { AssetKind, AssetLibrary, AssetMeta } from './index'
import type { GeneratedPreviewFile, GenerateVideoPreviewFileOptions } from './preview'
import { generateThumbnails } from '../resource/thumbnails'
import { extractWaveform } from '../resource/waveform'
import { createAssetLibrary } from './index'
import { generateVideoPreviewFile } from './preview'

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
  fps?: number
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
  fps?: number
}

export interface MediaAssetCatalogOptions {
  /** OPFS directory holding source media. */
  resourceDir?: string
  /** OPFS directory holding catalog metadata. */
  manifestDir?: string
  /** Required by remove() so referenced media cannot be deleted. */
  getProtectedProtocols?: () => readonly IVideoProtocol[] | Promise<readonly IVideoProtocol[]>
  /** Optional shared asset runtime. Existing OPFS catalog storage remains available during migration. */
  assetService?: Pick<AssetService, 'upsertAsset' | 'resolveUrl'>
}

export interface MediaAssetPreviewProgress {
  renditionId: string
  renditionRatio: number
  completedRenditions: number
  totalRenditions: number
  ratio: number
  elapsedMs: number
}

export interface GenerateMediaAssetPreviewOptions {
  /** Output height in pixels. Width follows the source aspect ratio. */
  height?: number
  /** Video bitrate in bits per second. */
  videoBitrate?: number
  /** AAC audio bitrate in bits per second. */
  audioBitrate?: number
  /** Maximum interval between key frames. */
  keyFrameIntervalMs?: number
  onProgress?: (progress: MediaAssetPreviewProgress) => void
  signal?: AbortSignal
}

const EDITING_PROXY_PROFILE = 'editing-mp4-v1'

export interface MediaAssetPreviewResolveContext {
  media: 'visual' | 'audio'
}

export interface MediaAssetCatalog {
  import: (file: File) => Promise<MediaAsset>
  list: () => Promise<MediaAsset[]>
  get: (id: string) => Promise<MediaAsset | undefined>
  bindForSegment: (id: string) => Promise<SegmentAssetBinding>
  getPreviewBlob: (id: string) => Promise<Blob | undefined>
  getThumbnails: (id: string, options?: GenerateThumbnailsOptions) => Promise<Thumbnail[]>
  getWaveform: (id: string, options?: WaveformOptions) => Promise<WaveformData>
  generatePreviewVersion: (id: string, options?: GenerateMediaAssetPreviewOptions) => Promise<MediaAsset>
  resolveForPreview: (id: string, fallbackUrl?: string, context?: MediaAssetPreviewResolveContext) => Promise<string | undefined>
  resolveForExport: (id: string) => Promise<string | undefined>
  resolveHandleForPreview: (id: string, fallbackUrl?: string) => Promise<AssetUrlHandle | undefined>
  resolveHandleForExport: (id: string) => Promise<AssetUrlHandle | undefined>
  remove: (id: string) => Promise<void>
}

function getProxyStatus(asset: AssetMeta, assets: readonly AssetMeta[]): MediaAssetProxyStatus {
  const proxies = assets.filter(candidate => candidate.derivation?.sourceAssetId === asset.id)
  if (!proxies.length)
    return 'none'
  return proxies.some(proxy => proxy.derivation?.sourceRevision === (asset.revision ?? 1)
    && proxy.derivation.profile === EDITING_PROXY_PROFILE)
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
    fps: asset.fps,
    proxyStatus: getProxyStatus(asset, assets),
  }
}

/** Public media catalog that keeps storage, URL, proxy, and OPFS details internal. */
export function createMediaAssetCatalog(options: MediaAssetCatalogOptions = {}): MediaAssetCatalog {
  return createMediaAssetCatalogFromLibrary(createAssetLibrary(options), options)
}

interface MediaAssetCatalogDependencies {
  generatePreviewFile: (
    source: Blob | string,
    sourceName: string,
    options: GenerateVideoPreviewFileOptions,
  ) => Promise<GeneratedPreviewFile>
}

/** Internal dependency-injection entry used by focused tests. */
export function createMediaAssetCatalogFromLibrary(
  library: AssetLibrary,
  options: Pick<MediaAssetCatalogOptions, 'getProtectedProtocols' | 'assetService'> = {},
  dependencies: MediaAssetCatalogDependencies = { generatePreviewFile: generateVideoPreviewFile },
): MediaAssetCatalog {
  const activePreviewGenerations = new Set<string>()
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
    await registerWithAssetService(asset)
    return toMediaAsset(asset, [asset])
  }

  async function registerWithAssetService(asset: AssetMeta) {
    if (!options.assetService)
      return
    const now = Date.now()
    await options.assetService.upsertAsset({
      assetId: asset.id,
      sourceRevision: asset.revision ?? 1,
      kind: asset.kind,
      name: asset.name,
      createdAt: asset.createdAt,
      updatedAt: now,
    }, [{
      assetId: asset.id,
      sourceRevision: asset.revision ?? 1,
      variantId: asset.derivation ? asset.id : 'source',
      profileId: asset.derivation?.profile,
      remoteRecovery: asset.url.startsWith('local-asset://') ? 'none' : 'host-refreshable',
      contentType: fileTypeFromName(asset.name),
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      createdAt: asset.createdAt,
      updatedAt: now,
    }])
  }

  async function resolveHandle(id: string, preferProxy: boolean, fallbackUrl?: string): Promise<AssetUrlHandle | undefined> {
    const assets = await library.listAssets()
    const target = resolveCatalogAsset(assets, id, preferProxy)
    if (!target)
      return undefined
    if (!options.assetService)
      return { url: target.url, source: 'url', release() {} }
    return await options.assetService.resolveUrl({
      ref: {
        assetId: target.derivation?.sourceAssetId ?? target.id,
        sourceRevision: target.derivation?.sourceRevision ?? target.revision ?? 1,
        variantId: target.derivation ? target.id : 'source',
      },
      fallbackUrl: fallbackUrl ?? target.url,
    })
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
      fps: asset.fps,
    }
  }

  async function getPreviewBlob(id: string): Promise<Blob | undefined> {
    await requireOriginal(id)
    return await library.getAssetFile(id, { preferProxy: true, proxyProfile: EDITING_PROXY_PROFILE })
  }

  async function getThumbnails(id: string, options?: GenerateThumbnailsOptions): Promise<Thumbnail[]> {
    const asset = await requireOriginal(id)
    if (asset.kind !== 'video')
      throw new Error(`Media asset ${id} is not a video`)
    const url = await library.resolveAssetUrl(id, { preferProxy: true, proxyProfile: EDITING_PROXY_PROFILE })
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

  async function generatePreviewVersion(
    id: string,
    options: GenerateMediaAssetPreviewOptions = {},
  ): Promise<MediaAsset> {
    const assets = await library.listAssets()
    const asset = assets.find(candidate => candidate.id === id && !candidate.derivation)
    if (!asset)
      throw new Error(`No media asset with id ${id}`)
    if (asset.kind !== 'video')
      throw new Error(`Media asset ${id} is not a video`)
    if (getProxyStatus(asset, assets) === 'ready')
      return toMediaAsset(asset, assets)
    if (activePreviewGenerations.has(id))
      throw new Error(`Preview generation is already running for media asset ${id}`)
    if (options.signal?.aborted)
      throw new DOMException('Preview generation aborted', 'AbortError')

    const height = options.height ?? Math.min(asset.height ?? 1080, 1080)
    const videoBitrate = options.videoBitrate
    const audioBitrate = options.audioBitrate ?? 192_000
    const keyFrameIntervalMs = options.keyFrameIntervalMs ?? 1000
    if (!Number.isFinite(height) || height <= 0)
      throw new TypeError('Preview height must be greater than 0')
    if (videoBitrate !== undefined && (!Number.isFinite(videoBitrate) || videoBitrate <= 0))
      throw new TypeError('Preview video bitrate must be greater than 0')
    if (!Number.isFinite(audioBitrate) || audioBitrate <= 0)
      throw new TypeError('Preview audio bitrate must be greater than 0')
    if (!Number.isFinite(keyFrameIntervalMs) || keyFrameIntervalMs <= 0)
      throw new TypeError('Preview key frame interval must be greater than 0')

    activePreviewGenerations.add(id)
    try {
      const originalFile = await library.getAssetFile(id)
      const source = originalFile ?? await library.resolveAssetUrl(id)
      if (!source)
        throw new Error(`No source data for media asset ${id}`)

      const generated = await dependencies.generatePreviewFile(source, asset.name, {
        height,
        videoBitrate,
        audioBitrate,
        keyFrameIntervalMs,
        onProgress: options.onProgress,
        signal: options.signal,
      })
      try {
        await library.importProxy(id, generated.file, EDITING_PROXY_PROFILE)
      }
      finally {
        // Cleanup must not replace a more useful import/revision error.
        await generated.cleanup().catch(() => {})
      }

      const updatedAssets = await library.listAssets()
      const updated = updatedAssets.find(candidate => candidate.id === id && !candidate.derivation)
      if (!updated)
        throw new Error(`Media asset ${id} disappeared after preview generation`)
      return toMediaAsset(updated, updatedAssets)
    }
    finally {
      activePreviewGenerations.delete(id)
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
    getPreviewBlob,
    getThumbnails,
    getWaveform,
    generatePreviewVersion,
    resolveForPreview: (id, _fallbackUrl, _context) => library.resolveAssetUrl(id, {
      preferProxy: true,
      proxyProfile: EDITING_PROXY_PROFILE,
    }),
    resolveForExport: id => library.resolveAssetUrl(id, {
      preferProxy: true,
      proxyProfile: EDITING_PROXY_PROFILE,
    }),
    resolveHandleForPreview: (id, fallbackUrl) => resolveHandle(id, true, fallbackUrl),
    resolveHandleForExport: id => resolveHandle(id, false),
    remove,
  }
}

function resolveCatalogAsset(assets: readonly AssetMeta[], id: string, preferProxy: boolean) {
  const source = assets.find(asset => asset.id === id)
  if (!source || !preferProxy)
    return source
  return assets.filter(asset => asset.derivation?.sourceAssetId === source.id
    && asset.derivation.sourceRevision === (source.revision ?? 1)
    && asset.derivation.profile === EDITING_PROXY_PROFILE)
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? source
}

function fileTypeFromName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'mp4')
    return 'video/mp4'
  if (extension === 'mp3')
    return 'audio/mpeg'
  if (extension === 'png')
    return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg')
    return 'image/jpeg'
  return undefined
}
