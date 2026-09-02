import type { EncoderFormat, EncoderOptions, WriteStats } from './encoder'
import type { MediaWriteSink } from './types'
import { checkEncoderSupport, createEncoder } from './encoder'

export interface CanvasVideoFrameContext {
  /** Zero-based frame index. */
  frameIndex: number
  /** Exact presentation time of this frame in milliseconds. */
  timeMs: number
  /** Duration assigned to this frame in milliseconds. */
  durationMs: number
}

export interface RenderCanvasToVideoProgress {
  framesDone: number
  framesTotal: number
  /** End time of the last encoded frame in milliseconds. */
  timeMs: number
}

export interface RenderCanvasToVideoOptions
  extends Omit<EncoderOptions, 'canvas' | 'format' | 'withAudio'> {
  canvas: HTMLCanvasElement | OffscreenCanvas
  durationMs: number
  fps: number
  /** Render the canvas at the exact requested media time before it is captured. */
  renderFrame: (context: CanvasVideoFrameContext) => void | Promise<void>
  sink: MediaWriteSink
  format?: EncoderFormat
  audio?: AudioBuffer
  signal?: AbortSignal
  onProgress?: (progress: RenderCanvasToVideoProgress) => void
}

export interface RenderCanvasToVideoResult {
  frameCount: number
  durationMs: number
  mimeType: string
  fileExtension: string
  writeStats: WriteStats
}

function assertPositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0)
    throw new TypeError(`renderCanvasToVideo: ${name} must be a positive finite number`)
}

function abortError() {
  return new DOMException('renderCanvasToVideo aborted', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw abortError()
}

/** Render a canvas on an exact media clock and encode it into a streaming video output. */
export async function renderCanvasToVideo(
  options: RenderCanvasToVideoOptions,
): Promise<RenderCanvasToVideoResult> {
  assertPositiveFinite(options.durationMs, 'durationMs')
  assertPositiveFinite(options.fps, 'fps')
  if (options.canvas.width <= 0 || options.canvas.height <= 0)
    throw new TypeError('renderCanvasToVideo: canvas dimensions must be greater than zero')
  throwIfAborted(options.signal)

  const supportError = await checkEncoderSupport({
    format: options.format,
    videoCodec: options.videoCodec,
    width: options.canvas.width,
    height: options.canvas.height,
    withAudio: !!options.audio,
  })
  if (supportError)
    throw new Error(`renderCanvasToVideo: ${supportError}`)
  throwIfAborted(options.signal)

  const frameDurationMs = 1000 / options.fps
  const framesTotal = Math.ceil(options.durationMs / frameDurationMs)
  const encoder = createEncoder({
    canvas: options.canvas,
    format: options.format,
    videoCodec: options.videoCodec,
    videoBitrate: options.videoBitrate,
    keyFrameIntervalMs: options.keyFrameIntervalMs,
    latencyMode: options.latencyMode,
    hardwareAcceleration: options.hardwareAcceleration,
    onEncoderConfig: options.onEncoderConfig,
    frameRate: options.fps,
    withAudio: !!options.audio,
    audioBitrate: options.audioBitrate,
  })
  const drained = encoder.stream.pipeTo(
    options.sink,
    options.signal ? { signal: options.signal } : undefined,
  )
  const onAbort = () => {
    void encoder.cancel().catch(() => {})
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    options.onProgress?.({ framesDone: 0, framesTotal, timeMs: 0 })
    if (options.audio)
      await encoder.setAudio(options.audio)

    for (let frameIndex = 0; frameIndex < framesTotal; frameIndex++) {
      throwIfAborted(options.signal)
      const timeMs = frameIndex * frameDurationMs
      const durationMs = Math.min(frameDurationMs, options.durationMs - timeMs)
      await options.renderFrame({ frameIndex, timeMs, durationMs })
      throwIfAborted(options.signal)
      await encoder.addFrame(timeMs, durationMs)
      options.onProgress?.({
        framesDone: frameIndex + 1,
        framesTotal,
        timeMs: Math.min(options.durationMs, timeMs + durationMs),
      })
    }

    await encoder.finalize()
    await drained
    throwIfAborted(options.signal)
    return {
      frameCount: framesTotal,
      durationMs: options.durationMs,
      mimeType: encoder.mimeType,
      fileExtension: encoder.fileExtension,
      writeStats: encoder.getWriteStats(),
    }
  }
  catch (error) {
    await encoder.cancel().catch(() => {})
    await Promise.allSettled([drained])
    if (options.signal?.aborted)
      throw abortError()
    throw error
  }
  finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
}
