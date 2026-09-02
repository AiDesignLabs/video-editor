import type { TranscodeProgress } from '@video-editor/media'
import { transcode } from '@video-editor/media'

export interface GenerateVideoPreviewFileOptions {
  height: number
  videoBitrate: number
  keyFrameIntervalMs: number
  onProgress?: (progress: TranscodeProgress) => void
  signal?: AbortSignal
}

export interface GeneratedPreviewFile {
  file: File
  cleanup: () => Promise<void>
}

function createTemporaryName() {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `video-editor-preview-${suffix}.mp4`
}

function createPreviewName(sourceName: string) {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'video'
  return `${base}.preview.mp4`
}

/** Encode one preview version into a temporary OPFS file without buffering it in JS memory. */
export async function generateVideoPreviewFile(
  source: Blob | string,
  sourceName: string,
  options: GenerateVideoPreviewFileOptions,
): Promise<GeneratedPreviewFile> {
  if (!navigator.storage?.getDirectory)
    throw new Error('Preview generation requires Origin Private File System support')
  if (options.signal?.aborted)
    throw new DOMException('Preview generation aborted', 'AbortError')

  const root = await navigator.storage.getDirectory()
  const temporaryName = createTemporaryName()
  const handle = await root.getFileHandle(temporaryName, { create: true })

  try {
    await transcode({
      source,
      renditions: [{
        id: 'preview',
        height: options.height,
        videoBitrate: options.videoBitrate,
        keyFrameIntervalMs: options.keyFrameIntervalMs,
      }],
      openSink: async () => await handle.createWritable(),
      pipelineDepth: 4,
      onProgress: options.onProgress,
      signal: options.signal,
    })

    const output = await handle.getFile()
    if (output.size === 0)
      throw new Error('Preview generation completed without output data')

    return {
      file: new File([output], createPreviewName(sourceName), { type: 'video/mp4' }),
      cleanup: async () => {
        await root.removeEntry(temporaryName)
      },
    }
  }
  catch (error) {
    await root.removeEntry(temporaryName).catch(() => {})
    throw error
  }
}
