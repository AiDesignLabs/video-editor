import { MP4Clip } from '@webav/av-cliper'
import { file as opfsFile, write as opfsWrite } from 'opfs-tools'
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
const mp4ClipUnsupportedKeys = new Set<string>()

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
  return msg.includes('stream is done') || msg.includes('not emit ready')
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
