import type { TranscodeProgress } from '@video-editor/media'
import type { VideoRenditionProfile } from '../types'
import { file as opfsFile, write as opfsWrite } from 'opfs-tools'

export interface ProcessedRendition {
  profileId: string
  file: File
  width: number
  height: number
}
export interface MediaProcessor {
  process: (request: {
    source: File
    profiles: readonly VideoRenditionProfile[]
    signal?: AbortSignal
    onProgress?: (progress: TranscodeProgress) => void
  }) => Promise<readonly ProcessedRendition[]>
}

export interface MediaPlaybackInspection {
  width?: number
  height?: number
  containerMimeType: string
  videoCodec: string | null
  audioCodec: string | null
  hasVideo: boolean
  hasAudio: boolean
}

export async function inspectMediaPlayback(source: File): Promise<MediaPlaybackInspection> {
  const media = await import('@video-editor/media')
  const input = media.openMediaInput(source)
  try {
    const metadata = await input.meta({ includeFrameRate: false, includeDuration: false })
    return {
      width: metadata.width,
      height: metadata.height,
      containerMimeType: metadata.containerMimeType,
      videoCodec: metadata.videoCodec,
      audioCodec: metadata.audioCodec,
      hasVideo: metadata.hasVideo,
      hasAudio: metadata.hasAudio,
    }
  }
  finally {
    input.dispose()
  }
}

export function createMediaProcessor(): MediaProcessor {
  return {
    async process(request) {
      if (!request.profiles.length)
        return []
      const media = await import('@video-editor/media')
      const input = media.openMediaInput(request.source)
      const metadata = await input.meta({ includeFrameRate: false })
      input.dispose()
      if (!metadata.hasVideo || metadata.width <= 0 || metadata.height <= 0)
        throw new Error('Media processing requires a video source with valid dimensions.')
      const outputByProfile = new Map<string, { path: string, write: Promise<void> }>()
      const jobId = crypto.randomUUID()
      try {
        const result = await media.transcode({
          source: request.source,
          renditions: request.profiles.map(profile => ({
            id: profile.id,
            height: outputHeight(metadata.width, metadata.height, profile.maxShortSide),
            videoBitrate: profile.videoBitrate,
            keyFrameIntervalMs: profile.keyFrameIntervalMs,
          })),
          audioBitrate: Math.max(...request.profiles.map(profile => profile.audioBitrate)),
          signal: request.signal,
          onProgress: request.onProgress,
          createCanvas: typeof OffscreenCanvas === 'undefined' ? undefined : (width: number, height: number) => new OffscreenCanvas(width, height),
          openSink(rendition) {
            const stream = new TransformStream<Uint8Array, Uint8Array>()
            const path = `/video-editor-assets/v1/temp/${jobId}/${rendition.id}.partial`
            outputByProfile.set(rendition.id, { path, write: opfsWrite(path, stream.readable as ReadableStream<BufferSource>, { overwrite: true }) })
            return stream.writable
          },
        })
        await Promise.all([...outputByProfile.values()].map(output => output.write))
        return await Promise.all(result.renditions.map(async (rendition) => {
          const output = outputByProfile.get(rendition.id)
          if (!output)
            throw new Error(`Media processing did not create output ${rendition.id}.`)
          const handle = opfsFile(output.path, 'r')
          const file = await handle.getOriginFile()
          if (!file)
            throw new Error(`Media processing output ${rendition.id} is unavailable.`)
          return {
            profileId: rendition.id,
            file: await materializeFileSnapshot(file, `${baseName(request.source.name)}.${rendition.id}.mp4`, 'video/mp4'),
            width: rendition.width,
            height: rendition.height,
          }
        }))
      }
      finally {
        await Promise.all([...outputByProfile.values()].map(async ({ path }) => {
          const handle = opfsFile(path)
          if (await handle.exists())
            await handle.remove()
        }))
      }
    },
  }
}

export async function materializeFileSnapshot(source: File, name: string, type: string) {
  const bytes = await source.arrayBuffer()
  return new File([bytes], name, { type, lastModified: source.lastModified })
}

function outputHeight(width: number, height: number, maxShortSide: number) {
  if (!Number.isFinite(maxShortSide) || maxShortSide <= 0)
    throw new TypeError('Rendition maxShortSide must be greater than 0.')
  if (Math.min(width, height) <= maxShortSide)
    return height
  return width <= height ? Math.round(height * maxShortSide / width) : maxShortSide
}

function baseName(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
