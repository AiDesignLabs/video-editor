import type { OTFile } from 'opfs-tools'
import { openMediaInput } from '@video-editor/media'
import { getCachedResourceFile } from './cache'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { getResourceKey } from './key'

export interface Mp4Meta {
  durationUs: number
  durationMs: number
  width: number
  height: number
  fps: number
  audioSampleRate: number
  audioChanCount: number
}

const metaCache = new Map<string, Promise<Mp4Meta>>()

export function clearMp4MetaCache(url?: string, resourceDir?: string): void {
  if (!url) {
    metaCache.clear()
    return
  }

  const resourceKey = getResourceKey(url)
  for (const key of metaCache.keys()) {
    const separatorIndex = key.indexOf('::')
    const cachedDir = key.slice(0, separatorIndex)
    const cachedResourceKey = key.slice(separatorIndex + 2)
    if (cachedResourceKey === resourceKey && (resourceDir === undefined || cachedDir === resourceDir))
      metaCache.delete(key)
  }
}

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
    const originFile = file ? await file.getOriginFile() : undefined
    const handle = openMediaInput(originFile ?? url)

    try {
      const meta = await handle.meta()
      return {
        durationUs: meta.durationMs * 1000,
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        audioSampleRate: meta.audioSampleRate,
        audioChanCount: meta.audioChanCount,
      }
    }
    catch {
      // Fallback to <video> metadata extraction when parsing fails.
      return await getMp4MetaViaVideoElement(url, file)
    }
    finally {
      handle.dispose()
    }
  })()

  metaCache.set(cacheKey, job)
  return job
}

async function getMp4MetaViaVideoElement(url: string, file?: OTFile): Promise<Mp4Meta> {
  if (typeof document === 'undefined') {
    return {
      durationUs: 0,
      durationMs: 0,
      width: 0,
      height: 0,
      fps: 0,
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
      fps: 0,
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
      fps: 0,
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
