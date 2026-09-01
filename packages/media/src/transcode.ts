import type { FrameTiming } from './encoder'
import type { MediaWriteSink } from './types'
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
import { createEncoder } from './encoder'

/**
 * Re-encoding one source into one or more smaller renditions.
 *
 * Every rendition is produced in a *single* decode pass: decoding dominates the
 * cost by a wide margin (measured on a 12.5-minute 720p H.264 source, adding a
 * second encoder to the same pass cost no measurable extra time), so decoding
 * once and fanning the frames out to several encoders is close to free compared
 * with running the whole job per rendition.
 */

/** One output to produce. */
export interface Rendition {
  /** Caller-chosen identity, echoed back on the result. */
  id: string
  /** Output height in pixels; width follows the source's aspect ratio. */
  height: number
  /** Video bitrate in bits per second. Defaults to the encoder's quality preset. */
  videoBitrate?: number
  /** Milliseconds between forced key frames — see `Mp4EncoderOptions`. */
  keyFrameIntervalMs?: number
  /** See `Mp4EncoderOptions.latencyMode`: `'realtime'` is faster but may drop frames. */
  latencyMode?: 'quality' | 'realtime'
  /** See `Mp4EncoderOptions.hardwareAcceleration`. */
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
}

/** Hints for the shared decoder. Hints only — browsers usually choose well. */
export interface DecoderOptions {
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  /** Ask the decoder to emit frames with as little internal buffering as it can. */
  optimizeForLatency?: boolean
}

export interface RenditionResult {
  id: string
  width: number
  height: number
  /** Frames handed to this rendition's encoder. */
  frameCount: number
  /** The WebCodecs config the encoder was actually created with, when reported. */
  encoderConfig?: VideoEncoderConfig
  /** True when frames bypassed the canvas (see `passthroughSameSize`). */
  passthrough: boolean
}

export interface TranscodeProgress {
  /** Source frames processed so far. */
  framesDone: number
  /** Total source frames, from the container's packet count. */
  framesTotal: number
  /** `framesDone / framesTotal`, clamped to 0–1; 0 while the total is unknown. */
  ratio: number
  /** Wall time since the frame loop started — with `ratio`, enough for an ETA. */
  elapsedMs: number
}

function progressOf(framesDone: number, framesTotal: number, startedAt: number): TranscodeProgress {
  return {
    framesDone,
    framesTotal,
    ratio: framesTotal > 0 ? Math.min(1, framesDone / framesTotal) : 0,
    elapsedMs: performance.now() - startedAt,
  }
}

export interface TranscodeOptions {
  /** The media to read: a `Blob`/`File`, or a URL read through range requests. */
  source: Blob | string
  renditions: Rendition[]
  /**
   * Where a rendition's bytes go. Called once per rendition before decoding
   * starts; the returned stream receives the container bytes in order and is
   * closed when that rendition finishes.
   *
   * Taking a sink rather than returning bytes keeps the whole output off the
   * heap — write it to OPFS or straight into an upload.
   */
  openSink: (rendition: Rendition) => MediaWriteSink | Promise<MediaWriteSink>
  /**
   * For a rendition whose output size equals the source, feed the decoded frame
   * straight to the encoder instead of drawing it into a canvas and capturing
   * that. Skips the RGBA canvas → VideoFrame conversion the encoder would
   * otherwise have to undo; decoded frames are already in an encoder-native
   * format.
   *
   * On by default. Measured, it does not change the wall time — the hardware
   * encoder is the floor either way — but it spares the same-size rendition an
   * RGBA round trip (chroma re-subsampled, colour matrix applied twice), so the
   * master-size copy stays closer to the source. Rotated and non-8-bit frames
   * fall back to the canvas automatically.
   */
  passthroughSameSize?: boolean
  /**
   * How many `addFrame()` calls may be outstanding per rendition before the
   * loop waits for one to settle. `1` (default) awaits every call, which puts
   * mediabunny's per-packet muxing promise on the frame loop's critical path;
   * a higher value lets that overlap with the next frame's decode and draw.
   * Frame order is unaffected — frames reach the encoder in call order.
   */
  pipelineDepth?: number
  decoder?: DecoderOptions
  onProgress?: (progress: TranscodeProgress) => void
  signal?: AbortSignal
}

/**
 * Where the wall-clock time of the pass went, measured from inside the loop
 * rather than inferred from totals.
 *
 * The loop is strictly sequential per frame — wait for the decoder, draw into
 * each rendition's canvas, hand each canvas to its encoder — so these buckets
 * add up to the loop's total and the largest one *is* the bottleneck.
 */
export interface TranscodeStages {
  /**
   * Gap between finishing one frame and receiving the next. That is decoder
   * wait when the loop is otherwise idle — but any microtasks queued by the
   * previous frame (mediabunny's deferred `add()` body and muxing chain) run
   * inside this gap too, so with `pipelineDepth > 1` it also carries that CPU.
   */
  decodeWaitMs: number
  /** Synchronous `draw()` into every rendition's canvas. */
  drawMs: number
  /** Per rendition: copying its canvas into a `VideoFrame` for the encoder. */
  captureMs: Record<string, number>
  /**
   * Per rendition: the *synchronous* part of handing the frame over — the
   * time `addFrame()` runs on the main thread before it yields its promise.
   * This is CPU, not waiting; pipelining cannot hide it.
   */
  submitSyncMs: Record<string, number>
  /**
   * Per rendition: time the loop was blocked on that rendition's `addFrame()`
   * — the encoder's queue plus, on mediabunny's path, its per-packet muxing
   * promise. With several renditions the encoders run concurrently, so the one
   * awaited later sees the wait the earlier ones already overlapped; and with
   * `pipelineDepth > 1` this is genuine blocked time, not the sum of each
   * call's own duration. Read these together, not in isolation.
   */
  encodeWaitMs: Record<string, number>
  /**
   * Per rendition: time inside the container writer handing bytes out. This
   * runs on the muxer's promise that `add()` awaits, so if it were large it
   * would show up as encoder wait — measured separately to rule it in or out.
   * Not part of the loop's serial time, so excluded from `otherMs`.
   */
  writeMs: Record<string, number>
  /** Everything else in the loop body (bookkeeping, progress callbacks). */
  otherMs: number
  totalMs: number
}

export interface TranscodeResult {
  renditions: RenditionResult[]
  /** Source frames decoded — the same for every rendition. */
  framesDecoded: number
  stages: TranscodeStages
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
      codec: track.codec,
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

interface TargetBase {
  rendition: Rendition
  width: number
  height: number
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  passthrough: boolean
  drained: Promise<void>
  getEncoderConfig: () => VideoEncoderConfig | undefined
  getWriteStats: () => { chunks: number, ms: number }
  cancel: () => Promise<void>
}

interface MediabunnyTarget extends TargetBase {
  encoder: ReturnType<typeof createEncoder>
  pending: Set<Promise<FrameTiming>>
}

type Target = MediabunnyTarget

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

export async function transcode(options: TranscodeOptions): Promise<TranscodeResult> {
  // Frames go through mediabunny's `VideoSampleSource`; it owns the encoder.
  // A raw-`VideoEncoder` engine was built and measured against it: in the
  // shipping shape (two renditions at once) both landed on 39.5 s, because two
  // hardware sessions contending for the media engine is the slower party, so
  // the custom engine was removed rather than kept as maintenance surface.
  const { source, renditions, openSink, onProgress, signal, passthroughSameSize = true } = options
  const pipelineDepth = Math.max(1, Math.floor(options.pipelineDepth ?? 1))
  if (renditions.length === 0)
    throw new Error('transcode: at least one rendition is required')

  const input = new Input({ formats: ALL_FORMATS, source: createSource(source) })

  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track)
      throw new Error('transcode: the source has no video track')
    if (!(await track.canDecode()))
      throw new Error('transcode: this browser cannot decode the source video track')

    const framesTotal = (await track.computePacketStats()).packetCount
    const sourceWidth = track.displayWidth
    const sourceHeight = track.displayHeight
    // Handed to the encoder as its rate-control hint — see `frameRate` on
    // `createEncoder`; without it the bitrate target is missed on non-30 fps sources.
    const sourceDurationSec = await input.computeDuration()
    const sourceFrameRate = framesTotal > 0 && sourceDurationSec > 0 ? framesTotal / sourceDurationSec : 25

    /**
     * A rendition may take decoded frames untouched only when nothing about
     * them has to change on the way to the encoder. Beyond matching size:
     * - rotation must be 0 — `draw()` applies the container's rotation, a raw
     *   frame does not, and its coded size would not even match the config;
     * - the pixel format must be 8-bit — an H.264 High-profile encoder rejects
     *   P010/P012, which the canvas path silently converts.
     * An unknown format is allowed: browsers only report `null` on closed frames.
     */
    const sourceRotation = track.rotation ?? 0
    const canPassthrough = (width: number, height: number) =>
      passthroughSameSize && width === sourceWidth && height === sourceHeight && sourceRotation === 0
    // WebCodecs spells every high-bit-depth format with a P10/P12 suffix
    // (I420P10, I444AP12, …); matching on bare digits would misread NV12.
    const isEightBit = (format: string | null | undefined) => !format || !/P1[02]$/.test(format)

    const prepareCanvas = (width: number, height: number) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx)
        throw new Error('transcode: could not create a 2D canvas context')
      return { canvas, ctx }
    }

    const targets: Target[] = await Promise.all(renditions.map(async (rendition): Promise<MediabunnyTarget> => {
      const height = toEvenPx(rendition.height)
      const width = toEvenPx(sourceWidth * (height / sourceHeight))

      const { canvas, ctx } = prepareCanvas(width, height)

      let encoderConfig: VideoEncoderConfig | undefined
      const encoder = createEncoder({
        canvas,
        videoBitrate: rendition.videoBitrate,
        keyFrameIntervalMs: rendition.keyFrameIntervalMs,
        latencyMode: rendition.latencyMode,
        hardwareAcceleration: rendition.hardwareAcceleration,
        frameRate: sourceFrameRate,
        onEncoderConfig: (config) => {
          encoderConfig = config
        },
      })
      // Drain concurrently: the encoder applies backpressure through `addFrame`,
      // so leaving the stream unread would stall the whole pass.
      const drained = encoder.stream.pipeTo(await openSink(rendition))

      const passthrough = canPassthrough(width, height)
      const pending = new Set<Promise<FrameTiming>>()
      return {
        rendition,
        width,
        height,
        ctx,
        canvas,
        encoder,
        drained,
        passthrough,
        pending,
        getEncoderConfig: () => encoderConfig,
        getWriteStats: () => encoder.getWriteStats(),
        cancel: () => encoder.cancel(),
      }
    }))

    const sampleSink = new VideoSampleSink(track, options.decoder)
    let framesDone = 0

    const stages: TranscodeStages = {
      decodeWaitMs: 0,
      drawMs: 0,
      captureMs: Object.fromEntries(targets.map(target => [target.rendition.id, 0])),
      submitSyncMs: Object.fromEntries(targets.map(target => [target.rendition.id, 0])),
      encodeWaitMs: Object.fromEntries(targets.map(target => [target.rendition.id, 0])),
      writeMs: Object.fromEntries(targets.map(target => [target.rendition.id, 0])),
      otherMs: 0,
      totalMs: 0,
    }
    const loopStartedAt = performance.now()
    // The gap between finishing one frame and receiving the next is time spent
    // waiting on the decoder (plus generator overhead, which is negligible).
    let lastFrameEndedAt = loopStartedAt

    try {
      for await (const sample of sampleSink.samples()) {
        const receivedAt = performance.now()
        stages.decodeWaitMs += receivedAt - lastFrameEndedAt

        if (signal?.aborted) {
          sample.close()
          throw new DOMException('transcode aborted', 'AbortError')
        }

        const timestampMs = sample.timestamp * 1000
        const durationMs = (sample.duration ?? 0) * 1000
        for (const target of targets) {
          const id = target.rendition.id

          let submission: Promise<FrameTiming>
          // Per-frame check on top of the per-rendition gate: a stream can switch
          // pixel format mid-file, and a 10-bit frame must take the canvas path
          // even when the size matches — the H.264 encoder is configured 8-bit.
          if (target.passthrough && isEightBit(sample.format)) {
            // A second reference to the decoded frame's backing store; closing
            // it does not affect `sample`, which the loop closes below. It is
            // released once the encoder has taken it, i.e. when add() settles.
            const frame = sample.toVideoFrame()
            const submitStartedAt = performance.now()
            submission = target.encoder.addVideoFrame(frame, timestampMs, durationMs).finally(() => frame.close())
            stages.submitSyncMs[id]! += performance.now() - submitStartedAt
          }
          else {
            const drawStartedAt = performance.now()
            sample.draw(target.ctx, 0, 0, target.width, target.height)
            stages.drawMs += performance.now() - drawStartedAt
            // addFrame() captures the canvas synchronously before returning,
            // so the next iteration may redraw immediately. The capture is
            // reported through the resolved timing and moved to its own bucket.
            const submitStartedAt = performance.now()
            submission = target.encoder.addFrame(timestampMs, durationMs)
            stages.submitSyncMs[id]! += performance.now() - submitStartedAt
          }

          const tracked = submission.then((timing) => {
            stages.captureMs[id]! += timing.captureMs
            stages.submitSyncMs[id]! -= timing.captureMs
            return timing
          })
          tracked.finally(() => target.pending.delete(tracked)).catch(() => {})
          target.pending.add(tracked)

          // Block only when this rendition has `pipelineDepth` calls in flight.
          if (target.pending.size >= pipelineDepth) {
            const waitStartedAt = performance.now()
            await Promise.race(target.pending)
            stages.encodeWaitMs[id]! += performance.now() - waitStartedAt
          }
        }
        // One decoded frame serves every rendition, then it is released.
        sample.close()

        framesDone += 1
        onProgress?.(progressOf(framesDone, framesTotal, loopStartedAt))
        lastFrameEndedAt = performance.now()
      }

      // Drain whatever is still in flight; with depth 1 this is a no-op.
      for (const target of targets) {
        const waitStartedAt = performance.now()
        await Promise.all(target.pending)
        stages.encodeWaitMs[target.rendition.id]! += performance.now() - waitStartedAt
      }

      for (const target of targets) {
        await target.encoder.finalize()
      }
      // Only now are the sinks guaranteed to have every byte.
      await Promise.all(targets.map(target => target.drained))
    }
    catch (error) {
      await Promise.all(targets.map(target => target.cancel().catch(() => {})))
      // Cancelling errors the sinks, so these settle as rejections; awaiting
      // them keeps those from surfacing as unhandled rejections after the
      // original error has already been thrown.
      await Promise.allSettled(targets.map(target => target.drained))
      throw error
    }

    stages.totalMs = performance.now() - loopStartedAt
    for (const target of targets)
      stages.writeMs[target.rendition.id] = target.getWriteStats().ms
    const sum = (record: Record<string, number>) => Object.values(record).reduce((total, ms) => total + ms, 0)
    const accounted = stages.decodeWaitMs + stages.drawMs + sum(stages.captureMs) + sum(stages.submitSyncMs) + sum(stages.encodeWaitMs)
    stages.otherMs = Math.max(0, stages.totalMs - accounted)

    return {
      stages,
      framesDecoded: framesDone,
      renditions: targets.map(target => ({
        id: target.rendition.id,
        width: target.width,
        height: target.height,
        frameCount: framesDone,
        encoderConfig: target.getEncoderConfig(),
        passthrough: target.passthrough,
      })),
    }
  }
  finally {
    // Holds a decoder and the source's read cache; skipping this leaks both,
    // which compounds when several files are transcoded in a row.
    await input.dispose()
  }
}

export interface DecodeThroughputOptions {
  /** Stop after this many frames; unset decodes the whole track. */
  maxFrames?: number
  decoder?: DecoderOptions
  onProgress?: (progress: TranscodeProgress) => void
  signal?: AbortSignal
}

export interface DecodeThroughput {
  frames: number
  ms: number
  /** Decoded frames per second — the ceiling no amount of encoder tuning can lift. */
  fps: number
}

/**
 * Decode-only pass: the same loop `transcode()` runs, minus every encoder.
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
  onProgress?: (progress: TranscodeProgress) => void
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
    const sourceWidth = track.displayWidth
    const sourceHeight = track.displayHeight
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
