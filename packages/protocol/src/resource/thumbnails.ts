import { MP4Clip } from '@webav/av-cliper'
import { file as opfsFile } from 'opfs-tools'
import { DEFAULT_RESOURCE_DIR } from './constants'

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

/** Generate thumbnails for a video, preferring OPFS resources with network fallback. */
export async function generateThumbnails(url: string, options?: GenerateThumbnailsOptions): Promise<Thumbnail[]> {
  if (!url)
    throw new Error('url is required')

  const {
    imgWidth = 100,
    start,
    end,
    step,
    resourceDir = DEFAULT_RESOURCE_DIR,
  } = options || {}

  const file = await getOpfsFile(url, resourceDir)
  const clip = await createClip(url, file)

  try {
    await clip.ready
    const thumbnailOpts = buildThumbnailOpts({ start, end, step })
    return await clip.thumbnails(imgWidth, thumbnailOpts)
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
    const file = opfsFile(`${resourceDir}/${url}`)
    if (await file.exists())
      return file
  }
  catch {
    // ignore OPFS read errors, fallback to network fetch
  }
  return undefined
}

function buildThumbnailOpts(opts: { start?: number, end?: number, step?: number }) {
  const { start, end, step } = opts
  const hasOpts = [start, end, step].some(v => v !== undefined)
  return hasOpts ? { start, end, step } : undefined
}
