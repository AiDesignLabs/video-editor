import { MP4Clip } from '@webav/av-cliper'
import { file as opfsFile } from 'opfs-tools'
import { DEFAULT_RESOURCE_DIR } from './constants'

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
  const cacheKey = `${resourceDir}::${url}`
  const cached = metaCache.get(cacheKey)
  if (cached)
    return cached

  const job = (async () => {
    const file = await getOpfsFile(url, resourceDir)
    const clip = await createClip(url, file)

    try {
      await clip.ready
      const meta = clip.meta
      const durationUs = Number.isFinite(meta.duration) ? meta.duration : 0
      const durationMs = Math.max(0, Math.floor(durationUs / 1000))
      return {
        durationUs,
        durationMs,
        width: meta.width,
        height: meta.height,
        audioSampleRate: (meta as any).audioSampleRate ?? 0,
        audioChanCount: (meta as any).audioChanCount ?? 0,
      }
    }
    finally {
      clip.destroy()
    }
  })()

  metaCache.set(cacheKey, job)
  job.catch(() => metaCache.delete(cacheKey))
  return job
}

async function createClip(url: string, file?: ReturnType<typeof opfsFile>) {
  if (file)
    return new MP4Clip(file)

  const res = await fetch(url)
  if (!res.body)
    throw new Error('failed to fetch resource for mp4 meta')

  return new MP4Clip(res.body)
}

async function getOpfsFile(url: string, resourceDir: string) {
  try {
    const file = opfsFile(`${resourceDir}/${url}`)
    if (await file.exists())
      return file
  }
  catch {
    // ignore OPFS read errors, fallback to network fetch
  }
  return undefined
}

