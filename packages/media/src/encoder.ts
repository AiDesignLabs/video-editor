import type { AudioCodec, OutputFormat, VideoCodec } from 'mediabunny'
import {
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  StreamTarget,
  WebMOutputFormat,
} from 'mediabunny'

export type Mp4VideoCodec = VideoCodec

/** Container formats the encoder can write. */
export type EncoderFormat = 'mp4' | 'webm'

/** Video codecs each container accepts. */
const SUPPORTED_VIDEO_CODECS: Record<EncoderFormat, readonly VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'vp9', 'av1'],
  webm: ['vp8', 'vp9', 'av1'],
}

const DEFAULT_VIDEO_CODEC: Record<EncoderFormat, VideoCodec> = {
  mp4: 'avc',
  webm: 'vp9',
}

const AUDIO_CODEC: Record<EncoderFormat, AudioCodec> = {
  mp4: 'aac',
  webm: 'opus',
}

export interface Mp4EncoderOptions {
  /** Canvas whose current state is captured on every `addFrame` call. */
  canvas: HTMLCanvasElement | OffscreenCanvas
  videoCodec?: Mp4VideoCodec
  /** Target video bitrate in bits per second; defaults to a high-quality preset. */
  videoBitrate?: number
  /** Add an AAC audio track fed via `setAudio`. */
  withAudio?: boolean
  /** Target audio bitrate in bits per second; defaults to a medium-quality preset. */
  audioBitrate?: number
}

export interface EncoderOptions extends Mp4EncoderOptions {
  /** Container format; defaults to `'mp4'`. */
  format?: EncoderFormat
}

export interface Mp4EncoderHandle {
  /** Fragmented MP4 bytes, produced while frames are being added. */
  stream: ReadableStream<Uint8Array>
  /**
   * Capture the current canvas state as the frame at `timestampMs`.
   * Awaiting the returned promise respects encoder backpressure.
   */
  addFrame: (timestampMs: number, durationMs: number) => Promise<void>
  /** Encode the mixed-down audio. Requires `withAudio`. */
  setAudio: (buffer: AudioBuffer) => Promise<void>
  finalize: () => Promise<void>
  cancel: () => Promise<void>
}

export interface EncoderHandle extends Mp4EncoderHandle {
  /** Container mime type, e.g. `video/mp4`. */
  mimeType: string
  /** Container file extension including the dot, e.g. `.mp4`. */
  fileExtension: string
}

function createOutputFormat(format: EncoderFormat): OutputFormat {
  // fastStart: 'fragmented' writes monotonically, so chunk positions can be
  // ignored and the payloads concatenated in order. WebM/MKV is streamable
  // through the same target plumbing without extra options.
  return format === 'webm'
    ? new WebMOutputFormat()
    : new Mp4OutputFormat({ fastStart: 'fragmented' })
}

function resolveVideoCodec(format: EncoderFormat, requested?: VideoCodec): VideoCodec {
  if (!requested)
    return DEFAULT_VIDEO_CODEC[format]

  const supported = SUPPORTED_VIDEO_CODECS[format]
  if (!supported.includes(requested)) {
    throw new Error(
      `createEncoder: video codec "${requested}" is not supported by the ${format} container (supported: ${supported.join(', ')})`,
    )
  }
  return requested
}

/** Create a streaming encoder (fMP4 or WebM) driven by an external render loop. */
export function createEncoder(options: EncoderOptions): EncoderHandle {
  const format = options.format ?? 'mp4'
  const videoCodec = resolveVideoCodec(format, options.videoCodec)
  const outputFormat = createOutputFormat(format)

  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })

  const writable = new WritableStream<{ type: 'write', data: Uint8Array<ArrayBuffer>, position: number }>({
    write(chunk) {
      streamController?.enqueue(chunk.data)
    },
    close() {
      try {
        streamController?.close()
      }
      catch {
        // The consumer may have cancelled the stream already.
      }
    },
  })

  const output = new Output({
    format: outputFormat,
    target: new StreamTarget(writable),
  })

  const videoSource = new CanvasSource(options.canvas, {
    codec: videoCodec,
    ...(options.videoBitrate ? { bitrate: options.videoBitrate } : { quality: QUALITY_HIGH }),
  })
  output.addVideoTrack(videoSource)

  let audioSource: AudioBufferSource | undefined
  if (options.withAudio) {
    audioSource = new AudioBufferSource({
      codec: AUDIO_CODEC[format],
      ...(options.audioBitrate ? { bitrate: options.audioBitrate } : { quality: QUALITY_MEDIUM }),
    })
    output.addAudioTrack(audioSource)
  }

  const started = output.start()

  return {
    stream,
    mimeType: outputFormat.mimeType,
    fileExtension: outputFormat.fileExtension,

    async addFrame(timestampMs, durationMs) {
      await started
      await videoSource.add(timestampMs / 1000, durationMs / 1000)
    },

    async setAudio(buffer) {
      if (!audioSource)
        throw new Error('encoder was created without audio; pass withAudio: true')
      await started
      await audioSource.add(buffer)
    },

    async finalize() {
      await started
      await output.finalize()
    },

    async cancel() {
      await output.cancel()
      try {
        streamController?.close()
      }
      catch {
        // Already closed by the target.
      }
    },
  }
}

/** Create a streaming fMP4 encoder driven by an external render loop. */
export function createMp4Encoder(options: Mp4EncoderOptions): Mp4EncoderHandle {
  return createEncoder({ ...options, format: 'mp4' })
}
