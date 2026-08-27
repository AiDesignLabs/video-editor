import type { OTFile } from 'opfs-tools'
import { MP4Clip } from '@webav/av-cliper'
import { getCachedResourceFile } from './cache'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { getResourceKey } from './key'

export interface Mp4Meta {
  durationUs: number
  durationMs: number
  width: number
  height: number
  audioSampleRate: number
  audioChanCount: number
}

const metaCache = new Map<string, Promise<Mp4Meta>>()

export function getMp4Meta(url: string, options?: { resourceDir?: string }): Promise<Mp4Meta> {
  if (!url)
    return Promise.reject(new Error('url is required'))

  const resourceDir = options?.resourceDir ?? DEFAULT_RESOURCE_DIR
  const cacheKey = `${resourceDir}::${getResourceKey(url)}`
  const cached = metaCache.get(cacheKey)
  if (cached)
    return cached

  const job = (async () => {
    const file = await getCachedResourceFile(url, resourceDir)
    const clip = await createClip(url, file)

    try {
      await clip.ready
      const meta = clip.meta as typeof clip.meta & {
        audioChanCount?: number
        audioSampleRate?: number
      }
      const durationUs = Number.isFinite(meta.duration) ? meta.duration : 0
      const durationMs = Math.max(0, Math.floor(durationUs / 1000))
      return {
        durationUs,
        durationMs,
        width: meta.width,
        height: meta.height,
        audioSampleRate: meta.audioSampleRate ?? 0,
        audioChanCount: meta.audioChanCount ?? 0,
      }
    }
    catch {
      // Fallback to <video> metadata extraction when MP4Clip parsing fails.
      return await getMp4MetaViaVideoElement(url, file)
    }
    finally {
      clip.destroy()
    }
  })()

  metaCache.set(cacheKey, job)
  return job
}

async function createClip(url: string, file?: OTFile) {
  if (file)
    return new MP4Clip(file)

  const res = await fetch(url)
  if (!res.body)
    throw new Error('failed to fetch resource for mp4 meta')

  return new MP4Clip(res.body)
}

async function getMp4MetaViaVideoElement(url: string, file?: OTFile): Promise<Mp4Meta> {
  if (typeof document === 'undefined') {
    return {
      durationUs: 0,
      durationMs: 0,
      width: 0,
      height: 0,
      audioSampleRate: 0,
      audioChanCount: 0,
    }
  }

  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true

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

    await new Promise<void>((resolve, reject) => {
      let cleanup = () => {}
      const onOk = () => {
        cleanup()
        resolve()
      }
      const onErr = () => {
        cleanup()
        reject(new Error('failed to read mp4 meta via <video>'))
      }
      cleanup = () => {
        video.removeEventListener('loadedmetadata', onOk)
        video.removeEventListener('error', onErr)
      }
      video.addEventListener('loadedmetadata', onOk, { once: true })
      video.addEventListener('error', onErr, { once: true })
    })

    const durationSec = Number.isFinite(video.duration) ? video.duration : 0
    const durationMs = Math.max(0, Math.floor(durationSec * 1000))
    const durationUs = Math.max(0, Math.floor(durationSec * 1_000_000))
    return {
      durationUs,
      durationMs,
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
      audioSampleRate: 0,
      audioChanCount: 0,
    }
  }
  catch {
    return {
      durationUs: 0,
      durationMs: 0,
      width: 0,
      height: 0,
      audioSampleRate: 0,
      audioChanCount: 0,
    }
  }
  finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    if (objectUrl)
      URL.revokeObjectURL(objectUrl)
  }
}
