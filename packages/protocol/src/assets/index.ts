import type { IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import { file as opfsFile, write as opfsWrite } from 'opfs-tools'
import { getCachedResourceFile } from '../resource/cache'
import { DEFAULT_RESOURCE_DIR } from '../resource/constants'
import { createResourceManager } from '../resource/index'
import { inferResourceTypeFromUrl } from '../resource/key'
import { getMp4Meta } from '../resource/meta'
import { extractWaveform } from '../resource/waveform'

export const DEFAULT_ASSET_MANIFEST_DIR = '/video-editor-assets'

const MANIFEST_FILE_NAME = 'manifest.json'

export type AssetKind = 'video' | 'audio' | 'image'

export interface AssetMeta {
  id: string
  /** Original file name provided by the user. */
  name: string
  /** Synthetic `local-asset://` url, usable directly as `segment.url`. */
  url: string
  /** Earlier locations kept for legacy URL-only protocol reference checks. */
  previousUrls?: string[]
  kind: AssetKind
  sizeBytes: number
  createdAt: number
  /** Video / audio only. */
  durationMs?: number
  /** Video / image only. */
  width?: number
  height?: number
}

export interface AssetLibrary {
  importAsset: (file: File) => Promise<AssetMeta>
  /** Newest first. */
  listAssets: () => Promise<AssetMeta[]>
  getAsset: (id: string) => Promise<AssetMeta | undefined>
  resolveAssetUrl: (id: string) => Promise<string | undefined>
  relinkAsset: (id: string, url: string) => Promise<AssetMeta>
  removeAsset: (id: string, context: AssetRemovalContext) => Promise<void>
  /** Origin OPFS File, useful for previews. */
  getAssetFile: (id: string) => Promise<File | undefined>
}

export interface AssetReference {
  protocolId: string
  trackId: string
  segmentId: string
}

export interface AssetRemovalContext {
  /** Every open or stored protocol that must remain valid after deletion. */
  protocols: readonly IVideoProtocol[]
}

export interface AssetLibraryOptions {
  /** OPFS directory holding the asset binaries (must match the renderer's resource dir). */
  resourceDir?: string
  /** OPFS directory holding `manifest.json`. */
  manifestDir?: string
}

/**
 * Serializes manifest writes per manifest path so concurrent imports/removals
 * never clobber each other's updates.
 */
const manifestQueues = new Map<string, Promise<unknown>>()

function enqueueManifestJob<T>(manifestPath: string, job: () => Promise<T>): Promise<T> {
  const previous = manifestQueues.get(manifestPath) ?? Promise.resolve()
  const next = previous.then(job, job)
  // Keep the chain alive even when a job rejects.
  manifestQueues.set(manifestPath, next.catch(() => {}))
  return next
}

function isAssetKind(value: string | undefined): value is AssetKind {
  return value === 'video' || value === 'audio' || value === 'image'
}

function detectKind(file: File): AssetKind | undefined {
  const byExtension = inferResourceTypeFromUrl(file.name)
  if (isAssetKind(byExtension))
    return byExtension

  const mime = file.type
  if (mime.startsWith('video/'))
    return 'video'
  if (mime.startsWith('audio/'))
    return 'audio'
  if (mime.startsWith('image/'))
    return 'image'

  return undefined
}

function createAssetId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isAssetMeta(value: unknown): value is AssetMeta {
  if (!value || typeof value !== 'object')
    return false
  const meta = value as Partial<AssetMeta>
  return typeof meta.id === 'string'
    && typeof meta.name === 'string'
    && typeof meta.url === 'string'
    && isAssetKind(meta.kind)
    && typeof meta.sizeBytes === 'number'
    && typeof meta.createdAt === 'number'
    && (meta.previousUrls === undefined || (Array.isArray(meta.previousUrls) && meta.previousUrls.every(url => typeof url === 'string')))
}

function isAbsoluteUrl(url: string) {
  try {
    return Boolean(new URL(url).protocol)
  }
  catch {
    return false
  }
}

export function findAssetReferences(protocol: IVideoProtocol, asset: Pick<AssetMeta, 'id' | 'url' | 'previousUrls'>): AssetReference[] {
  const references: AssetReference[] = []
  const knownUrls = new Set([asset.url, ...(asset.previousUrls ?? [])])
  for (const track of protocol.tracks) {
    for (const segment of track.children) {
      if (!('url' in segment))
        continue
      const media = segment as SegmentUnion & { assetId?: string, url: string }
      if (media.assetId !== asset.id && (media.assetId !== undefined || !knownUrls.has(media.url)))
        continue
      references.push({ protocolId: protocol.id, trackId: track.trackId, segmentId: segment.id })
    }
  }
  return references
}

async function readManifest(manifestPath: string): Promise<AssetMeta[]> {
  try {
    const handle = opfsFile(manifestPath, 'r')
    if (!(await handle.exists()))
      return []

    const text = await handle.text()
    if (!text)
      return []

    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed))
      return []

    return parsed.filter(isAssetMeta)
  }
  catch {
    // A missing or corrupt manifest must never break listing.
    return []
  }
}

/** Atomic write: fill a temporary file first, then move it onto the target path. */
async function writeManifest(manifestPath: string, assets: AssetMeta[]) {
  const temporaryPath = `${manifestPath}.partial-${createAssetId()}`
  const temporaryFile = opfsFile(temporaryPath)
  const targetFile = opfsFile(manifestPath)

  try {
    if (await temporaryFile.exists())
      await temporaryFile.remove()

    const blob = new Blob([JSON.stringify(assets)], { type: 'application/json' })
    await opfsWrite(temporaryPath, blob.stream(), { overwrite: true })
    await temporaryFile.moveTo(targetFile)
  }
  catch (error) {
    try {
      if (await temporaryFile.exists())
        await temporaryFile.remove()
    }
    catch {
      // Cleanup must not replace the original write error.
    }
    throw error
  }
}

async function probeImageSize(url: string, resourceDir: string) {
  const cached = await getCachedResourceFile(url, resourceDir)
  const originFile = cached ? await cached.getOriginFile() : undefined
  if (!originFile)
    throw new Error('Imported image is not available in OPFS')

  const bitmap = await createImageBitmap(originFile)
  try {
    return { width: bitmap.width, height: bitmap.height }
  }
  finally {
    bitmap.close()
  }
}

async function probeMetadata(url: string, kind: AssetKind, resourceDir: string): Promise<Partial<AssetMeta>> {
  if (kind === 'video') {
    const meta = await getMp4Meta(url, { resourceDir })
    return { durationMs: meta.durationMs, width: meta.width, height: meta.height }
  }

  if (kind === 'audio') {
    const waveform = await extractWaveform(url, { resourceDir })
    return { durationMs: Math.round(waveform.duration * 1000) }
  }

  return await probeImageSize(url, resourceDir)
}

/**
 * Local asset library backed by OPFS.
 *
 * Binaries live in the shared resource cache (so the renderer resolves them
 * offline-first), while a single JSON manifest tracks their metadata.
 */
export function createAssetLibrary(options: AssetLibraryOptions = {}): AssetLibrary {
  const resourceDir = options.resourceDir ?? DEFAULT_RESOURCE_DIR
  const manifestDir = options.manifestDir ?? DEFAULT_ASSET_MANIFEST_DIR
  const manifestPath = `${manifestDir}/${MANIFEST_FILE_NAME}`
  const resourceManager = createResourceManager({ dir: resourceDir })

  async function listAssets(): Promise<AssetMeta[]> {
    const assets = await readManifest(manifestPath)
    return [...assets].sort((a, b) => b.createdAt - a.createdAt)
  }

  async function getAsset(id: string): Promise<AssetMeta | undefined> {
    const assets = await readManifest(manifestPath)
    return assets.find(asset => asset.id === id)
  }

  async function resolveAssetUrl(id: string): Promise<string | undefined> {
    return (await getAsset(id))?.url
  }

  async function importAsset(file: File): Promise<AssetMeta> {
    const kind = detectKind(file)
    if (!kind)
      throw new Error(`Unsupported asset type for file "${file.name}": expected video, audio or image`)

    const id = createAssetId()
    const url = `local-asset://${id}/${encodeURIComponent(file.name)}`

    await resourceManager.add(url, { body: file.stream() })

    let probed: Partial<AssetMeta> = {}
    try {
      probed = await probeMetadata(url, kind, resourceDir)
    }
    catch (error) {
      // Metadata is best effort: a probe failure must not fail the import.
      console.error(`[assets] failed to probe metadata for "${file.name}"`, error)
    }

    const meta: AssetMeta = {
      id,
      name: file.name,
      url,
      kind,
      sizeBytes: file.size,
      createdAt: Date.now(),
      ...probed,
    }

    await enqueueManifestJob(manifestPath, async () => {
      const assets = await readManifest(manifestPath)
      await writeManifest(manifestPath, [...assets, meta])
    })

    return meta
  }

  async function relinkAsset(id: string, url: string): Promise<AssetMeta> {
    if (!isAbsoluteUrl(url))
      throw new Error('Asset URL must be absolute')

    const result = await enqueueManifestJob(manifestPath, async () => {
      const assets = await readManifest(manifestPath)
      const index = assets.findIndex(asset => asset.id === id)
      if (index < 0)
        throw new Error(`No asset with id ${id}`)
      const inferredKind = inferResourceTypeFromUrl(url)
      if (inferredKind && inferredKind !== assets[index].kind)
        throw new Error(`Cannot relink ${assets[index].kind} asset ${id} to ${inferredKind} media`)
      const previousUrl = assets[index].url
      const previousUrls = [...new Set([...(assets[index].previousUrls ?? []), previousUrl])]
        .filter(previous => previous !== url)
      const updated = { ...assets[index], url, previousUrls }
      assets[index] = updated
      await writeManifest(manifestPath, assets)
      return updated
    })
    return result
  }

  async function removeAsset(id: string, context: AssetRemovalContext): Promise<void> {
    if (!context || !Array.isArray(context.protocols))
      throw new TypeError('Asset removal requires an explicit protocols list')
    const removed = await enqueueManifestJob(manifestPath, async () => {
      const assets = await readManifest(manifestPath)
      const target = assets.find(asset => asset.id === id)
      if (!target)
        return undefined

      const references = context.protocols.flatMap(protocol => findAssetReferences(protocol, target))
      if (references.length) {
        const segments = references.map(reference => reference.segmentId).join(', ')
        throw new Error(`Cannot remove asset ${id}; referenced by segment(s): ${segments}`)
      }

      await writeManifest(manifestPath, assets.filter(asset => asset.id !== id))
      return target
    })

    if (!removed)
      return

    for (const url of new Set([removed.url, ...(removed.previousUrls ?? [])])) {
      try {
        await resourceManager.remove(url)
      }
      catch (error) {
        // The manifest entry is already gone; a stale binary is harmless.
        console.error(`[assets] failed to remove binary for asset "${id}"`, error)
      }
    }
  }

  async function getAssetFile(id: string): Promise<File | undefined> {
    const assets = await readManifest(manifestPath)
    const target = assets.find(asset => asset.id === id)
    if (!target)
      return undefined

    const cached = await getCachedResourceFile(target.url, resourceDir)
    if (!cached)
      return undefined

    return await cached.getOriginFile()
  }

  return {
    importAsset,
    listAssets,
    getAsset,
    resolveAssetUrl,
    relinkAsset,
    removeAsset,
    getAssetFile,
  }
}
