import type { VideoCodec } from 'mediabunny'
import {
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  StreamTarget,
} from 'mediabunny'

export type Mp4VideoCodec = VideoCodec

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

/** Create a streaming fMP4 encoder driven by an external render loop. */
export function createMp4Encoder(options: Mp4EncoderOptions): Mp4EncoderHandle {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })

  // fastStart: 'fragmented' writes monotonically, so chunk positions can be
  // ignored and the payloads concatenated in order.
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
    format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
    target: new StreamTarget(writable),
  })

  const videoSource = new CanvasSource(options.canvas, {
    codec: options.videoCodec ?? 'avc',
    ...(options.videoBitrate ? { bitrate: options.videoBitrate } : { quality: QUALITY_HIGH }),
  })
  output.addVideoTrack(videoSource)

  let audioSource: AudioBufferSource | undefined
  if (options.withAudio) {
    audioSource = new AudioBufferSource({
      codec: 'aac',
      ...(options.audioBitrate ? { bitrate: options.audioBitrate } : { quality: QUALITY_MEDIUM }),
    })
    output.addAudioTrack(audioSource)
  }

  const started = output.start()

  return {
    stream,

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
