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
  removeAsset: (id: string) => Promise<void>
  /** Origin OPFS File, useful for previews. */
  getAssetFile: (id: string) => Promise<File | undefined>
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

  async function removeAsset(id: string): Promise<void> {
    const removed = await enqueueManifestJob(manifestPath, async () => {
      const assets = await readManifest(manifestPath)
      const target = assets.find(asset => asset.id === id)
      if (!target)
        return undefined

      await writeManifest(manifestPath, assets.filter(asset => asset.id !== id))
      return target
    })

    if (!removed)
      return

    try {
      await resourceManager.remove(removed.url)
    }
    catch (error) {
      // The manifest entry is already gone; a stale binary is harmless.
      console.error(`[assets] failed to remove binary for asset "${id}"`, error)
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
    removeAsset,
    getAssetFile,
  }
}
