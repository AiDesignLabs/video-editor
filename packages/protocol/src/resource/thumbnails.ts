import { MP4Clip } from '@webav/av-cliper'
import { dir as opfsDir, file as opfsFile, write as opfsWrite } from 'opfs-tools'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { inferResourceTypeFromUrl, getResourceKey, getResourceOpfsPath } from './key'

export interface GenerateThumbnailsOptions {
  /** Thumbnail width in pixels (default 100). */
  imgWidth?: number
  /** Start time in microseconds. */
  start?: number
  /** End time in microseconds. */
  end?: number
  /** Step duration in microseconds; fallback to keyframes when omitted. */
  step?: number
  /** OPFS resource directory; defaults to `/video-editor-res`. */
  resourceDir?: string
}

export interface Thumbnail {
  ts: number
  img: Blob
}

const inflightCacheByPath = new Map<string, Promise<void>>()
const inflightThumbnails = new Map<string, Promise<Thumbnail[]>>()
const thumbnailCache = new Map<string, Thumbnail[]>()
const mp4ClipUnsupportedKeys = new Set<string>()
const maxThumbnailCacheEntries = 24
const thumbnailManifestName = 'manifest.json'
const thumbnailIndexName = 'index.json'
const thumbnailCacheVersion = 1
const thumbnailOpfsTtlMs = 1000 * 60 * 60 * 24 * 7
const maxThumbnailOpfsEntriesPerResource = 6

interface ThumbnailManifest {
  version: number
  createdAt: number
  items: Array<{ ts: number, path: string }>
}

interface ThumbnailIndexEntry {
  key: string
  baseDir: string
  createdAt: number
  lastAccessAt: number
  version: number
}

/** Generate thumbnails for a video, preferring OPFS resources with network fallback. */
export async function generateThumbnails(url: string, options?: GenerateThumbnailsOptions): Promise<Thumbnail[]> {
  if (!url)
    throw new Error('url is required')

  const type = inferResourceTypeFromUrl(url)
  if (type && type !== 'video')
    return []

  const {
    imgWidth = 100,
    start,
    end,
    step,
    resourceDir = DEFAULT_RESOURCE_DIR,
  } = options || {}

  const cacheKey = buildThumbnailCacheKey(url, { imgWidth, start, end, step, resourceDir })
  const cached = getCachedThumbnails(cacheKey)
  if (cached)
    return cached

  if (shouldUseThumbnailOpfs(url)) {
    const opfsCached = await readThumbnailsFromOpfs(url, { imgWidth, start, end, step, resourceDir })
    if (opfsCached) {
      cacheThumbnails(cacheKey, opfsCached)
      return opfsCached
    }
  }

  const inflight = inflightThumbnails.get(cacheKey)
  if (inflight)
    return await inflight

  const job = generateThumbnailsInner(url, { imgWidth, start, end, step, resourceDir })
  inflightThumbnails.set(cacheKey, job)
  try {
    const result = await job
    cacheThumbnails(cacheKey, result)
    if (shouldUseThumbnailOpfs(url))
      void writeThumbnailsToOpfs(url, { imgWidth, start, end, step, resourceDir }, result)
    return result
  }
  finally {
    inflightThumbnails.delete(cacheKey)
  }
}

async function generateThumbnailsInner(url: string, opts: Required<Pick<GenerateThumbnailsOptions, 'imgWidth' | 'resourceDir'>> & Pick<GenerateThumbnailsOptions, 'start' | 'end' | 'step'>): Promise<Thumbnail[]> {
  const { imgWidth, start, end, step, resourceDir } = opts
  const file = await getOpfsFile(url, resourceDir) ?? await ensureCached(url, resourceDir)
  const urlKey = `${resourceDir}::${getResourceKey(url)}`
  if (urlKey && mp4ClipUnsupportedKeys.has(urlKey))
    return await generateThumbnailsViaVideoElement(url, file, { imgWidth, start, end, step })

  const clip = await createClip(url, file)

  try {
    await clip.ready
    const thumbnailOpts = buildThumbnailOpts({ start, end, step })
    return await clip.thumbnails(imgWidth, thumbnailOpts)
  }
  catch (err) {
    if (urlKey && isMp4ClipUnsupported(err))
      mp4ClipUnsupportedKeys.add(urlKey)
    return await generateThumbnailsViaVideoElement(url, file, { imgWidth, start, end, step })
  }
  finally {
    clip.destroy()
  }
}

async function createClip(url: string, file?: ReturnType<typeof opfsFile>) {
  if (file)
    return new MP4Clip(file)

  const res = await fetch(url)
  if (!res.body)
    throw new Error('failed to fetch resource for thumbnails')

  return new MP4Clip(res.body)
}

async function getOpfsFile(url: string, resourceDir: string) {
  try {
    const path = getResourceOpfsPath(resourceDir, url)
    if (!path)
      return undefined
    const file = opfsFile(path, 'r')
    if (await file.exists())
      return file
  }
  catch {
    // ignore OPFS read errors, fallback to network fetch
  }
  return undefined
}

async function ensureCached(url: string, resourceDir: string) {
  // Avoid caching non-network URLs into OPFS.
  if (url.startsWith('data:') || url.startsWith('blob:'))
    return undefined

  const path = getResourceOpfsPath(resourceDir, url)
  if (!path)
    return undefined

  const existing = opfsFile(path, 'r')
  try {
    if (await existing.exists())
      return existing
  }
  catch {
    return undefined
  }

  const inflight = inflightCacheByPath.get(path)
  if (inflight) {
    await inflight.catch(() => {})
    return await getOpfsFile(url, resourceDir)
  }

  const job = (async () => {
    const res = await fetch(url)
    if (!res.body)
      throw new Error('failed to fetch resource for thumbnails')
    await opfsWrite(path, res.body, { overwrite: true })
  })()

  inflightCacheByPath.set(path, job)
  try {
    await job
  }
  finally {
    inflightCacheByPath.delete(path)
  }

  return await getOpfsFile(url, resourceDir)
}

function isMp4ClipUnsupported(err: unknown) {
  if (!(err instanceof Error))
    return false
  const msg = err.message || ''
  return msg.includes('stream is done')
    || msg.includes('not emit ready')
    || msg.includes('tick video timeout')
    || msg.toLowerCase().includes('call stack')
}

function shouldUseThumbnailOpfs(url: string) {
  return !!url && !url.startsWith('blob:') && !url.startsWith('data:')
}

function buildThumbnailVariantKey(opts: { imgWidth: number, start?: number, end?: number, step?: number }) {
  return [opts.imgWidth, opts.start ?? '', opts.end ?? '', opts.step ?? ''].join('-')
}

function buildThumbnailOpfsBaseDir(resourceDir: string, url: string, opts: { imgWidth: number, start?: number, end?: number, step?: number }) {
  const key = getResourceKey(url)
  if (!key)
    return ''
  const variantKey = buildThumbnailVariantKey(opts)
  return `${resourceDir}/thumbnails/${key}/${variantKey}`
}

function getThumbnailIndexPath(resourceDir: string, resourceKey: string) {
  return `${resourceDir}/thumbnails/${resourceKey}/${thumbnailIndexName}`
}

async function readThumbnailsFromOpfs(
  url: string,
  opts: { imgWidth: number, start?: number, end?: number, step?: number, resourceDir: string },
): Promise<Thumbnail[] | undefined> {
  const resourceKey = getResourceKey(url)
  if (!resourceKey)
    return undefined
  const baseDir = buildThumbnailOpfsBaseDir(opts.resourceDir, url, opts)
  if (!baseDir)
    return undefined

  try {
    const manifestPath = `${baseDir}/${thumbnailManifestName}`
    const manifestFile = opfsFile(manifestPath, 'r')
    if (!(await manifestFile.exists()))
      return undefined

    const originFile = await manifestFile.getOriginFile()
    if (!originFile)
      return undefined

    const text = await originFile.text()
    const parsed = JSON.parse(text) as ThumbnailManifest | Array<{ ts: number, path: string }>
    const manifest = Array.isArray(parsed)
      ? { version: 0, createdAt: 0, items: parsed }
      : parsed
    if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0)
      return undefined

    if (manifest.version !== thumbnailCacheVersion) {
      await removeThumbnailEntry(baseDir)
      await removeThumbnailIndexEntry(resourceKey, opts.resourceDir, buildThumbnailVariantKey(opts))
      return undefined
    }

    const now = Date.now()
    if (manifest.createdAt && now - manifest.createdAt > thumbnailOpfsTtlMs) {
      await removeThumbnailEntry(baseDir)
      await removeThumbnailIndexEntry(resourceKey, opts.resourceDir, buildThumbnailVariantKey(opts))
      return undefined
    }

    const results: Thumbnail[] = []
    for (const item of manifest.items) {
      const file = opfsFile(item.path, 'r')
      if (!(await file.exists()))
        throw new Error('thumbnail file missing')
      const origin = await file.getOriginFile()
      if (!origin)
        throw new Error('thumbnail origin missing')
      results.push({ ts: item.ts, img: origin })
    }

    await updateThumbnailIndex(resourceKey, opts.resourceDir, {
      key: buildThumbnailVariantKey(opts),
      baseDir,
      createdAt: manifest.createdAt || now,
      lastAccessAt: now,
      version: manifest.version,
    })
    return results
  }
  catch {
    await removeThumbnailEntry(baseDir)
    await removeThumbnailIndexEntry(resourceKey, opts.resourceDir, buildThumbnailVariantKey(opts))
    return undefined
  }
}

async function writeThumbnailsToOpfs(
  url: string,
  opts: { imgWidth: number, start?: number, end?: number, step?: number, resourceDir: string },
  thumbnails: Thumbnail[],
) {
  if (!thumbnails.length)
    return
  const baseDir = buildThumbnailOpfsBaseDir(opts.resourceDir, url, opts)
  if (!baseDir)
    return

  try {
    const createdAt = Date.now()
    const manifestItems: Array<{ ts: number, path: string }> = []
    for (const thumb of thumbnails) {
      const path = `${baseDir}/${thumb.ts}.png`
      await opfsWrite(path, thumb.img.stream(), { overwrite: true })
      manifestItems.push({ ts: thumb.ts, path })
    }
    const manifest: ThumbnailManifest = {
      version: thumbnailCacheVersion,
      createdAt,
      items: manifestItems,
    }
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
    await opfsWrite(`${baseDir}/${thumbnailManifestName}`, manifestBlob.stream(), { overwrite: true })

    const resourceKey = getResourceKey(url)
    if (resourceKey) {
      await updateThumbnailIndex(resourceKey, opts.resourceDir, {
        key: buildThumbnailVariantKey(opts),
        baseDir,
        createdAt,
        lastAccessAt: createdAt,
        version: thumbnailCacheVersion,
      })
    }
  }
  catch {
    // ignore OPFS write failures
  }
}

async function readThumbnailIndex(resourceKey: string, resourceDir: string): Promise<ThumbnailIndexEntry[]> {
  const path = getThumbnailIndexPath(resourceDir, resourceKey)
  try {
    const file = opfsFile(path, 'r')
    if (!(await file.exists()))
      return []
    const origin = await file.getOriginFile()
    if (!origin)
      return []
    const text = await origin.text()
    const parsed = JSON.parse(text) as ThumbnailIndexEntry[]
    if (!Array.isArray(parsed))
      return []
    return parsed.filter(entry => entry && typeof entry.key === 'string' && typeof entry.baseDir === 'string')
  }
  catch {
    return []
  }
}

async function writeThumbnailIndex(resourceKey: string, resourceDir: string, entries: ThumbnailIndexEntry[]) {
  const path = getThumbnailIndexPath(resourceDir, resourceKey)
  const blob = new Blob([JSON.stringify(entries)], { type: 'application/json' })
  await opfsWrite(path, blob.stream(), { overwrite: true })
}

async function updateThumbnailIndex(resourceKey: string, resourceDir: string, entry: ThumbnailIndexEntry) {
  const entries = await readThumbnailIndex(resourceKey, resourceDir)
  const now = Date.now()
  const next = entries.filter(item => item.key !== entry.key)
  next.unshift({ ...entry, lastAccessAt: entry.lastAccessAt || now })
  next.sort((a, b) => b.lastAccessAt - a.lastAccessAt)
  const keep = next.slice(0, maxThumbnailOpfsEntriesPerResource)
  const evicted = next.slice(maxThumbnailOpfsEntriesPerResource)
  for (const item of evicted)
    await removeThumbnailEntry(item.baseDir)
  await writeThumbnailIndex(resourceKey, resourceDir, keep)
}

async function removeThumbnailIndexEntry(resourceKey: string, resourceDir: string, entryKey: string) {
  const entries = await readThumbnailIndex(resourceKey, resourceDir)
  const next = entries.filter(entry => entry.key !== entryKey)
  if (next.length === entries.length)
    return
  await writeThumbnailIndex(resourceKey, resourceDir, next)
}

async function removeThumbnailEntry(baseDir: string) {
  if (!baseDir)
    return
  try {
    const dir = opfsDir(baseDir)
    if (await dir.exists())
      await dir.remove()
  }
  catch {
    // ignore OPFS cleanup failures
  }
}

function buildThumbnailCacheKey(url: string, opts: { imgWidth: number, start?: number, end?: number, step?: number, resourceDir: string }) {
  return [opts.resourceDir, url, opts.imgWidth, opts.start ?? '', opts.end ?? '', opts.step ?? ''].join('::')
}

function getCachedThumbnails(key: string) {
  const value = thumbnailCache.get(key)
  if (!value)
    return undefined
  thumbnailCache.delete(key)
  thumbnailCache.set(key, value)
  return value
}

function cacheThumbnails(key: string, value: Thumbnail[]) {
  if (!value.length)
    return
  thumbnailCache.set(key, value)
  if (thumbnailCache.size <= maxThumbnailCacheEntries)
    return
  const oldestKey = thumbnailCache.keys().next().value
  if (oldestKey)
    thumbnailCache.delete(oldestKey)
}

async function generateThumbnailsViaVideoElement(
  url: string,
  file: ReturnType<typeof opfsFile> | undefined,
  opts: { imgWidth: number, start?: number, end?: number, step?: number },
): Promise<Thumbnail[]> {
  if (typeof document === 'undefined')
    return []

  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  let objectUrl: string | undefined
  try {
    if (file) {
      const originFile = await file.getOriginFile()
      if (originFile) {
        objectUrl = URL.createObjectURL(originFile)
        video.src = objectUrl
      }
      else {
        video.src = url
      }
    }
    else {
      video.src = url
    }

    await waitForVideoEvent(video, 'loadedmetadata', 4000)

    const durationUs = Number.isFinite(video.duration) ? Math.floor(video.duration * 1_000_000) : 0
    if (durationUs <= 0)
      return []

    const startUs = Math.max(0, opts.start ?? 0)
    const endUs = Math.min(durationUs, opts.end ?? durationUs)
    const stepUs = Math.max(1, opts.step ?? 1_000_000)
    if (endUs <= startUs)
      return []

    const width = video.videoWidth || 1
    const height = video.videoHeight || 1
    const scale = opts.imgWidth / Math.max(width, 1)
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return []

    const results: Thumbnail[] = []
    for (let ts = startUs; ts <= endUs; ts += stepUs) {
      const targetSec = ts / 1_000_000
      // Seek and draw.
      try {
        video.currentTime = targetSec
      }
      catch {
        // ignore seek errors when not ready; rely on canplay/seeked below
      }
      await waitForVideoEvent(video, 'seeked', 1500).catch(() => {})
      if (video.readyState < 2)
        await waitForVideoEvent(video, 'canplay', 1500).catch(() => {})

      if (video.readyState < 2)
        continue

      ctx.drawImage(video, 0, 0, targetW, targetH)
      const blob = await canvasToBlob(canvas)
      if (blob)
        results.push({ ts, img: blob })
    }

    return results
  }
  catch {
    return []
  }
  finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    if (objectUrl)
      URL.revokeObjectURL(objectUrl)
  }
}

function waitForVideoEvent(video: HTMLVideoElement, type: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for video event: ${type}`))
    }, timeoutMs)

    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error(`Video error while waiting for ${type}`))
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener(type, onOk)
      video.removeEventListener('error', onErr)
    }

    video.addEventListener(type, onOk, { once: true })
    video.addEventListener('error', onErr, { once: true })
  })
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | undefined>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/png')
    }
    catch {
      resolve(undefined)
    }
  })
}

function buildThumbnailOpts(opts: { start?: number, end?: number, step?: number }) {
  const { start, end, step } = opts
  const hasOpts = [start, end, step].some(v => v !== undefined)
  return hasOpts ? { start, end, step } : undefined
}
