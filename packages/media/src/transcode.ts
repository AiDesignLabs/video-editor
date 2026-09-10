import {
  ALL_FORMATS,
  BlobSource,
  canDecodeVideo,
  canEncodeVideo,
  EncodedPacketSink,
  Input,
  UrlSource,
  VideoSampleSink,
} from 'mediabunny'

export { MediaConversionError, transcode } from './conversion'
export type { Rendition, RenditionResult, TranscodeOptions, TranscodeProgress, TranscodeResult } from './conversion'

export interface DecoderOptions {
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  optimizeForLatency?: boolean
}

export interface FrameProcessingProgress {
  framesDone: number
  framesTotal: number
  ratio: number
  elapsedMs: number
}

function progressOf(framesDone: number, framesTotal: number, startedAt: number): FrameProcessingProgress {
  return { framesDone, framesTotal, ratio: framesTotal > 0 ? Math.min(1, framesDone / framesTotal) : 0, elapsedMs: performance.now() - startedAt }
}

/** H.264 requires even dimensions. */
function toEvenPx(value: number) {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Smallest H.264 High-profile level whose macroblock budget fits the picture
 * at the given frame rate, as an `avc1.6400xx` codec string.
 *
 * A fixed level would be wrong in both directions: too low and the encoder
 * rejects a 4K source outright; needlessly high and some hardware encoders
 * refuse or fall back to software. Limits are the spec's MaxMBPS / MaxFS
 * (Table A-1); anything past 5.2 is capped there.
 */
export function avcHighCodecString(width: number, height: number, fps: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  const mbps = macroblocks * Math.max(1, fps)
  const levels: Array<{ hex: string, maxFs: number, maxMbps: number }> = [
    { hex: '1e', maxFs: 1620, maxMbps: 40500 }, // 3.0 — 720x576@25
    { hex: '1f', maxFs: 3600, maxMbps: 108000 }, // 3.1 — 1280x720@30
    { hex: '20', maxFs: 5120, maxMbps: 216000 }, // 3.2 — 1280x720@60
    { hex: '28', maxFs: 8192, maxMbps: 245760 }, // 4.0 — 1920x1080@30
    { hex: '2a', maxFs: 8704, maxMbps: 522240 }, // 4.2 — 1920x1080@60
    { hex: '32', maxFs: 22080, maxMbps: 589824 }, // 5.0 — 2560x1920@30
    { hex: '33', maxFs: 36864, maxMbps: 983040 }, // 5.1 — 3840x2160@30
    { hex: '34', maxFs: 36864, maxMbps: 2073600 }, // 5.2 — 3840x2160@60
  ]
  const level = levels.find(l => macroblocks <= l.maxFs && mbps <= l.maxMbps) ?? levels[levels.length - 1]!
  return `avc1.6400${level.hex}`
}

function createSource(source: Blob | string) {
  return typeof source === 'string' ? new UrlSource(source) : new BlobSource(source)
}

export interface VideoStats {
  /** Codec identifier, e.g. `avc`. Null when the container does not report one. */
  codec: string | null
  /** Frames in the video track. */
  frameCount: number
  fps: number
  keyFrameCount: number
  /**
   * Average seconds between key frames, or `null` when the track has fewer than
   * two. This is what decides how expensive seeking into the file is.
   */
  gopSec: number | null
}

/**
 * Frame and key-frame statistics for a file's primary video track.
 *
 * Kept out of `openMediaInput().meta()` because it walks the key-frame index,
 * which costs real I/O on a large file — callers should opt in.
 */
export async function probeVideoStats(source: Blob | string): Promise<VideoStats | undefined> {
  const input = new Input({ formats: ALL_FORMATS, source: createSource(source) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track)
      return undefined

    const durationSec = await input.computeDuration()
    const stats = await track.computePacketStats()

    const packetSink = new EncodedPacketSink(track)
    let packet = await packetSink.getFirstPacket({ metadataOnly: true })
    let keyFrameCount = 0
    let firstKeyTs = 0
    let lastKeyTs = 0
    while (packet) {
      if (keyFrameCount === 0)
        firstKeyTs = packet.timestamp
      lastKeyTs = packet.timestamp
      keyFrameCount += 1
      packet = await packetSink.getNextKeyPacket(packet, { metadataOnly: true })
    }

    return {
      codec: await track.getCodec(),
      frameCount: stats.packetCount,
      fps: durationSec > 0 ? stats.packetCount / durationSec : 0,
      keyFrameCount,
      // n key frames span n-1 intervals.
      gopSec: keyFrameCount > 1 ? (lastKeyTs - firstKeyTs) / (keyFrameCount - 1) : null,
    }
  }
  finally {
    await input.dispose()
  }
}

/**
 * Resolves once the encoder's queue has room again.
 *
 * Normally that is the `dequeue` event. Older Safari never fires it, and an
 * `await` on it would hang the whole transcode, so the queue is also polled
 * as a fallback — the poll is coarse on purpose, it only has to catch that case.
 */
function waitForDequeue(encoder: VideoEncoder, inFlight: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    let poll: ReturnType<typeof setInterval> | undefined
    const done = () => {
      if (settled)
        return
      settled = true
      encoder.removeEventListener('dequeue', done)
      if (poll !== undefined)
        clearInterval(poll)
      resolve()
    }
    encoder.addEventListener('dequeue', done, { once: true })
    poll = setInterval(() => {
      if (encoder.state !== 'configured' || encoder.encodeQueueSize < inFlight)
        done()
    }, 20)
  })
}

export interface DecodeThroughputOptions {
  /** Stop after this many frames; unset decodes the whole track. */
  maxFrames?: number
  decoder?: DecoderOptions
  onProgress?: (progress: FrameProcessingProgress) => void
  signal?: AbortSignal
}

export interface DecodeThroughput {
  frames: number
  ms: number
  /** Decoded frames per second — the ceiling no amount of encoder tuning can lift. */
  fps: number
}

/**
 * Decode-only diagnostic, independent of the SDK's file conversion pipeline.
 *
 * Two uses. As a diagnostic it separates "the decoder is the bottleneck" from
 * "the per-frame draw/encode stage is" — the answer decides which optimisation
 * is worth doing. As a pre-flight, with `maxFrames` set, it lets a host
 * estimate how long a full transcode would take on *this* machine before
 * offering it.
 */
export async function measureDecodeThroughput(
  source: Blob | string,
  options: DecodeThroughputOptions = {},
): Promise<DecodeThroughput> {
  const { maxFrames, decoder, onProgress, signal } = options
  const input = new Input({ formats: ALL_FORMATS, source: createSource(source) })

  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track)
      throw new Error('measureDecodeThroughput: the source has no video track')
    if (!(await track.canDecode()))
      throw new Error('measureDecodeThroughput: this browser cannot decode the source video track')

    const framesTotal = (await track.computePacketStats()).packetCount
    const limit = maxFrames === undefined ? framesTotal : Math.min(maxFrames, framesTotal)
    const sampleSink = new VideoSampleSink(track, decoder)

    const startedAt = performance.now()
    let frames = 0
    for await (const sample of sampleSink.samples()) {
      sample.close()
      if (signal?.aborted)
        throw new DOMException('measureDecodeThroughput aborted', 'AbortError')
      frames += 1
      onProgress?.(progressOf(frames, limit, startedAt))
      if (frames >= limit)
        break
    }
    const ms = performance.now() - startedAt

    return { frames, ms, fps: ms > 0 ? (frames / ms) * 1000 : 0 }
  }
  finally {
    await input.dispose()
  }
}

export type AccelerationPreference = 'no-preference' | 'prefer-hardware' | 'prefer-software'

export interface CodecSupportProbe {
  /** What was asked. */
  width: number
  height: number
  /** `canEncodeVideo('avc', …)` per acceleration hint. */
  encode: Record<AccelerationPreference, boolean>
  /** `canDecodeVideo('avc', …)` per acceleration hint. */
  decode: Record<AccelerationPreference, boolean>
}

const ACCELERATION_PREFERENCES: AccelerationPreference[] = ['no-preference', 'prefer-hardware', 'prefer-software']

/**
 * Asks the browser which H.264 encoder/decoder configurations it will accept
 * at a given size, per acceleration hint. Browsers never say which
 * implementation they chose, but they do say whether a hint is satisfiable —
 * if `prefer-software` encode comes back `false`, a run made with that hint
 * was silently served by the hardware encoder, which explains identical timings.
 */
export async function probeCodecSupport(options: { width: number, height: number, bitrate?: number }): Promise<CodecSupportProbe> {
  const { width, height, bitrate } = options
  const encode = {} as Record<AccelerationPreference, boolean>
  const decode = {} as Record<AccelerationPreference, boolean>
  for (const hardwareAcceleration of ACCELERATION_PREFERENCES) {
    encode[hardwareAcceleration] = await canEncodeVideo('avc', {
      width,
      height,
      ...(bitrate ? { bitrate } : {}),
      hardwareAcceleration,
    }).catch(() => false)
    decode[hardwareAcceleration] = await canDecodeVideo('avc', {
      codedWidth: width,
      codedHeight: height,
      hardwareAcceleration,
    }).catch(() => false)
  }
  return { width, height, encode, decode }
}

export interface EncoderThroughputOptions {
  /** Output height; width follows the source. Equal to the source height → frames are passed through untouched. */
  height: number
  videoBitrate?: number
  keyFrameIntervalMs?: number
  /** Frames allowed in flight before waiting for `dequeue`. mediabunny hard-codes 4. */
  maxQueue?: number
  /** `framerate` given to the encoder config. Chrome defaults to 30 when omitted. */
  framerate?: number
  latencyMode?: 'quality' | 'realtime'
  hardwareAcceleration?: AccelerationPreference
  decoder?: DecoderOptions
  onProgress?: (progress: FrameProcessingProgress) => void
  signal?: AbortSignal
}

export interface EncoderThroughput {
  frames: number
  ms: number
  fps: number
  /** Time blocked waiting for the encoder to take frames — the number to compare against `transcode()`'s encodeWaitMs. */
  encodeWaitMs: number
  waitPerFrameMs: number
  /** Encoded chunks the encoder emitted. Should equal `frames`; fewer means it dropped some. */
  chunks: number
  /** True when decoded frames were handed over without a canvas in between. */
  passthrough: boolean
  maxQueue: number
  config: VideoEncoderConfig
}

/**
 * The encode leg of the pipeline on raw WebCodecs — same decoded frames, same
 * in-flight limit, but no muxer, no container, nothing of mediabunny's between
 * the frame and `VideoEncoder.encode()`.
 *
 * Exists to split one number in two. `transcode()` measures how long it is
 * blocked handing a frame to mediabunny's `add()`; that call wraps both the
 * WebCodecs encoder and mediabunny's own per-packet muxing chain, and they
 * cannot be told apart from outside. Comparing this wait with that one is the
 * only way to say which side owns the time — and `maxQueue` lets you check
 * whether the encoder is latency-bound (deeper queue helps) or
 * throughput-bound (it does not).
 */
export async function measureEncoderThroughput(
  source: Blob | string,
  options: EncoderThroughputOptions,
): Promise<EncoderThroughput> {
  const {
    height: requestedHeight,
    videoBitrate = 2_500_000,
    keyFrameIntervalMs = 2000,
    maxQueue = 4,
    framerate,
    latencyMode,
    hardwareAcceleration,
    decoder,
    onProgress,
    signal,
  } = options

  const input = new Input({ formats: ALL_FORMATS, source: createSource(source) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track)
      throw new Error('measureEncoderThroughput: the source has no video track')
    if (!(await track.canDecode()))
      throw new Error('measureEncoderThroughput: this browser cannot decode the source video track')

    const framesTotal = (await track.computePacketStats()).packetCount
    const [sourceWidth, sourceHeight] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
    ])
    const height = toEvenPx(requestedHeight)
    const width = toEvenPx(sourceWidth * (height / sourceHeight))
    const passthrough = width === sourceWidth && height === sourceHeight

    let ctx: CanvasRenderingContext2D | null = null
    let canvas: HTMLCanvasElement | null = null
    if (!passthrough) {
      canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx)
        throw new Error('measureEncoderThroughput: could not create a 2D canvas context')
    }

    const config: VideoEncoderConfig = {
      codec: avcHighCodecString(width, height, framerate ?? 30),
      width,
      height,
      bitrate: videoBitrate,
      ...(framerate ? { framerate } : {}),
      ...(latencyMode ? { latencyMode } : {}),
      ...(hardwareAcceleration ? { hardwareAcceleration } : {}),
      avc: { format: 'avc' },
    }
    const support = await VideoEncoder.isConfigSupported(config)
    if (!support.supported)
      throw new Error(`measureEncoderThroughput: encoder config not supported: ${JSON.stringify(config)}`)

    let chunks = 0
    let encoderError: unknown
    const encoder = new VideoEncoder({
      output: () => {
        chunks += 1
      },
      error: (error) => {
        encoderError = error
      },
    })
    encoder.configure(config)

    const sampleSink = new VideoSampleSink(track, decoder)
    let lastKeyFrameBucket = -1
    const startedAt = performance.now()
    let frames = 0
    let encodeWaitMs = 0

    try {
      for await (const sample of sampleSink.samples()) {
        if (signal?.aborted) {
          sample.close()
          throw new DOMException('measureEncoderThroughput aborted', 'AbortError')
        }
        if (encoderError)
          throw encoderError

        const waitStartedAt = performance.now()
        let frame: VideoFrame
        if (passthrough) {
          frame = sample.toVideoFrame()
        }
        else {
          sample.draw(ctx!, 0, 0, width, height)
          frame = new VideoFrame(canvas!, {
            timestamp: Math.round(sample.timestamp * 1e6),
            duration: Math.round((sample.duration ?? 0) * 1e6),
          })
        }
        const bucket = Math.floor(sample.timestamp / (keyFrameIntervalMs / 1000))
        const keyFrame = bucket !== lastKeyFrameBucket
        if (keyFrame)
          lastKeyFrameBucket = bucket
        try {
          encoder.encode(frame, { keyFrame })
        }
        finally {
          frame.close()
        }
        sample.close()

        // Same policy mediabunny uses, with the limit exposed.
        if (encoder.encodeQueueSize >= maxQueue)
          await waitForDequeue(encoder, maxQueue)
        encodeWaitMs += performance.now() - waitStartedAt

        frames += 1
        onProgress?.(progressOf(frames, framesTotal, startedAt))
      }
      await encoder.flush()
    }
    finally {
      if (encoder.state !== 'closed')
        encoder.close()
    }
    if (encoderError)
      throw encoderError

    const ms = performance.now() - startedAt
    return {
      frames,
      ms,
      fps: ms > 0 ? (frames / ms) * 1000 : 0,
      encodeWaitMs,
      waitPerFrameMs: frames > 0 ? encodeWaitMs / frames : 0,
      chunks,
      passthrough,
      maxQueue,
      config: support.config ?? config,
    }
  }
  finally {
    await input.dispose()
  }
}
