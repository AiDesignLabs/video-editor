import type { AudioCodec, OutputFormat, VideoCodec } from 'mediabunny'
import {
  AudioBufferSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from 'mediabunny'

/**
 * Where one `addFrame()` call spent its time. Returned so a caller can tell a
 * slow canvas capture from a slow encoder — the two are otherwise indistinguishable
 * from outside.
 */
export interface FrameTiming {
  /** `new VideoFrame(canvas)`: copying the canvas into a frame the encoder can take. */
  captureMs: number
  /** Blocked handing the frame to the encoder (its queue / muxer backpressure). */
  submitMs: number
}

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
  /**
   * Milliseconds between forced key frames. Defaults to the encoder's own
   * choice (2s at the time of writing).
   *
   * This is the number that decides seek latency: a player seeking to an
   * arbitrary point must rewind to the preceding key frame and decode forward
   * from there, so a proxy encoded with a long interval is no faster to scrub
   * than the source it was made from.
   */
  keyFrameIntervalMs?: number
  /**
   * `'quality'` (the encoder's default) never drops frames; `'realtime'` trades
   * lookahead for speed and *may drop frames* under load. Fine for a scrubbing
   * proxy, wrong for anything that has to play back every frame.
   */
  latencyMode?: 'quality' | 'realtime'
  /**
   * Hint only; browsers usually pick well on their own. Exposed so a host can
   * A/B it on platforms where the default lands on a software encoder.
   */
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  /**
   * Source frame rate, handed to the encoder as its rate-control hint.
   *
   * Without it Chrome assumes 30 fps and budgets bits per frame accordingly, so
   * a 25 fps source lands 1/6 under the requested bitrate (measured: 2.07 Mbps
   * out of 2.5). Passed as track metadata, which is the field mediabunny reads
   * into the encoder config; it does *not* switch on mediabunny's constant-
   * frame-rate padding, which keys off a different option.
   */
  frameRate?: number
  /**
   * Called with the WebCodecs `VideoEncoderConfig` mediabunny ends up using —
   * codec string, dimensions, and whether an acceleration hint survived. The
   * browser never reports which implementation it picked, but this is the
   * closest observable to "what did we actually ask for".
   */
  onEncoderConfig?: (config: VideoEncoderConfig) => void
  /** Add an AAC audio track fed via `setAudio`. */
  withAudio?: boolean
  /** Target audio bitrate in bits per second; defaults to a medium-quality preset. */
  audioBitrate?: number
}

export interface EncoderOptions extends Mp4EncoderOptions {
  /** Container format; defaults to `'mp4'`. */
  format?: EncoderFormat
}

/** Time spent inside the container writer's `write()`; how much of a frame's wait was muxing/output. */
export interface WriteStats {
  chunks: number
  ms: number
}

export interface Mp4EncoderHandle {
  /** Fragmented MP4 bytes, produced while frames are being added. */
  stream: ReadableStream<Uint8Array>
  /** Cumulative cost of handing container bytes to `stream`. */
  getWriteStats: () => WriteStats
  /**
   * Capture the current canvas state as the frame at `timestampMs`.
   * Awaiting the returned promise respects encoder backpressure. The resolved
   * timing can be ignored by callers that do not need it.
   */
  addFrame: (timestampMs: number, durationMs: number) => Promise<FrameTiming>
  /**
   * Hand an existing `VideoFrame` to the encoder without touching the canvas.
   * The caller keeps ownership of `frame` and closes it after this resolves.
   * `captureMs` is always 0 on the returned timing.
   */
  addVideoFrame: (frame: VideoFrame, timestampMs: number, durationMs: number) => Promise<FrameTiming>
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

  const writeStats: WriteStats = { chunks: 0, ms: 0 }
  const writable = new WritableStream<{ type: 'write', data: Uint8Array<ArrayBuffer>, position: number }>({
    write(chunk) {
      // Timed so a caller can tell muxer/output cost apart from encoder wait:
      // this is the only place the muxer's per-packet promise can block on us.
      const startedAt = performance.now()
      streamController?.enqueue(chunk.data)
      writeStats.chunks += 1
      writeStats.ms += performance.now() - startedAt
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

  /*
   * `VideoSampleSource` rather than `CanvasSource`. The latter is only a
   * convenience wrapper that captures the canvas lazily *inside* `add()`, which
   * makes the capture cost invisible; capturing eagerly here lets `addFrame()`
   * report capture and encoder wait separately.
   */
  const videoSource = new VideoSampleSource({
    codec: videoCodec,
    ...(options.videoBitrate ? { bitrate: options.videoBitrate } : { quality: QUALITY_HIGH }),
    ...(options.keyFrameIntervalMs === undefined
      ? {}
      : { keyFrameInterval: options.keyFrameIntervalMs / 1000 }),
    ...(options.latencyMode ? { latencyMode: options.latencyMode } : {}),
    ...(options.hardwareAcceleration ? { hardwareAcceleration: options.hardwareAcceleration } : {}),
    ...(options.onEncoderConfig ? { onEncoderConfig: options.onEncoderConfig } : {}),
  })
  output.addVideoTrack(videoSource, options.frameRate ? { frameRate: options.frameRate } : undefined)

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
    getWriteStats: () => ({ ...writeStats }),

    async addFrame(timestampMs, durationMs) {
      // Capture before any await: a caller that pipelines several addFrame()
      // calls will redraw the canvas for the next frame as soon as this returns
      // its promise, so the pixels have to be taken synchronously, here.
      const captureStartedAt = performance.now()
      // VideoFrame wants microseconds; the sample below is told the same
      // instant in seconds so the two never disagree.
      const frame = new VideoFrame(options.canvas, {
        timestamp: Math.round(timestampMs * 1000),
        duration: Math.round(durationMs * 1000),
      })
      const submitStartedAt = performance.now()
      try {
        await started
        await videoSource.add(new VideoSample(frame, {
          timestamp: timestampMs / 1000,
          duration: durationMs / 1000,
        }))
      }
      finally {
        // The source does not own the frame (it was built from a VideoFrame),
        // and `add()` has already handed the pixels to the encoder by the time
        // it resolves, so this is the right moment to release it.
        frame.close()
      }
      return {
        captureMs: submitStartedAt - captureStartedAt,
        submitMs: performance.now() - submitStartedAt,
      }
    },

    async addVideoFrame(frame, timestampMs, durationMs) {
      await started
      const submitStartedAt = performance.now()
      await videoSource.add(new VideoSample(frame, {
        timestamp: timestampMs / 1000,
        duration: durationMs / 1000,
      }))
      return { captureMs: 0, submitMs: performance.now() - submitStartedAt }
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
