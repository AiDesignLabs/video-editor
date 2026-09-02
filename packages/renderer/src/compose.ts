import type { EncoderFormat, Mp4VideoCodec } from '@video-editor/media'
import type { IVideoProtocol } from '@video-editor/shared'
import type { ApplicationOptions } from 'pixi.js'
import type { RendererOptions } from './renderer-core'
import type { ComposeAudioInput } from './timeline'
import { checkEncoderSupport, createEncoder, openMediaInput } from '@video-editor/media'
import { normalizePlayRate, sourceSpanMs } from '@video-editor/shared'
import { Application } from 'pixi.js'
import { resolveProtocolAssetUrls } from './asset-resolution'
import { reverseAudioBufferInPlace } from './helpers'
import { createRenderer } from './renderer-core'
import { createComposeAudioInputs, sampleFrames } from './timeline'

export interface ComposeClipOptions {
  appOptions?: Partial<ApplicationOptions>
  rendererOptions?: Partial<Omit<RendererOptions, 'protocol' | 'app' | 'appOptions'>>
}

export interface ComposeProtocolOptions {
  width?: number
  height?: number
  fps?: number
  onProgress?: (progress: number) => void
  clipOptions?: ComposeClipOptions
  /** Container format; defaults to `'mp4'`. */
  format?: EncoderFormat
  videoCodec?: Mp4VideoCodec
  /** Target video bitrate in bits per second. */
  bitrate?: number
  /** Target audio bitrate in bits per second. */
  audioBitrate?: number
  /** Pass `false` to skip the audio track entirely. */
  audio?: false
  /**
   * Aborts the export. Resource loads in flight are cancelled, each phase
   * boundary re-checks it, and the encode stops at the next frame.
   */
  signal?: AbortSignal
}

export interface ComposeProtocolResult {
  /**
   * Container bytes. The stream is *errored*, not closed, when the encode
   * fails, so a consumer that only reads the stream still sees the failure
   * rather than a truncated file that looks valid.
   */
  stream: ReadableStream<Uint8Array>
  width: number
  height: number
  durationMs: number
  /** Container mime type of `stream`, e.g. `video/mp4`. */
  mimeType: string
  /** Container file extension including the dot, e.g. `.mp4`. */
  fileExtension: string
  /**
   * Settles when encoding ends. Resolves only once the video, the requested
   * audio and every frame have been written; rejects with the encoding error
   * otherwise, and with an `AbortError` when `destroy()` stopped the export.
   *
   * Encoding runs in the background after `composeProtocol` resolves, so this
   * is the only way to observe an error raised after that point.
   */
  completion: Promise<void>
  /** Stop the export, release resources and reject `completion` with an `AbortError`. */
  destroy: () => void
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

const RESOURCE_TIMEOUT_MS = 12000
const MIX_SAMPLE_RATE = 48000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(`composeProtocol: ${label} timed out (${timeoutMs}ms)`))
    }, timeoutMs)
    promise
      .then((value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        globalThis.clearTimeout(timer)
        reject(err)
      })
  })
}

function normalizeVolume(volume?: number): number {
  if (typeof volume !== 'number' || !Number.isFinite(volume))
    return 1
  return Math.max(0, Math.min(1, volume))
}

function throwIfAborted(signal: AbortSignal | undefined, phase: string) {
  if (signal?.aborted)
    throw abortError(`composeProtocol: export was cancelled while ${phase}`)
}

async function fetchBlob(url: string, signal?: AbortSignal, timeoutMs: number = RESOURCE_TIMEOUT_MS): Promise<Blob> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok)
      throw new Error(`composeProtocol: failed to load resource (${response.status} ${response.statusText}): ${url}`)
    return await response.blob()
  }
  catch (err) {
    if (signal?.aborted)
      throw abortError(`composeProtocol: export was cancelled while loading ${url}`)
    if (controller.signal.aborted)
      throw new Error(`composeProtocol: loading resource timed out (${timeoutMs}ms): ${url}`)
    throw err
  }
  finally {
    globalThis.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function decodeInputAudioSlice(input: ComposeAudioInput, signal?: AbortSignal): Promise<AudioBuffer | undefined> {
  const blob = await fetchBlob(input.url, signal)
  const handle = openMediaInput(blob)
  try {
    if (!(await handle.canDecodeAudio()))
      return undefined
    const fromTimeMs = Math.max(0, input.fromTime ?? 0)
    const spanMs = sourceSpanMs(input)
    if (spanMs <= 0)
      return undefined
    const buffer = await withTimeout(
      handle.decodeAudioSlice(fromTimeMs, fromTimeMs + spanMs),
      RESOURCE_TIMEOUT_MS,
      `decode audio: ${input.url}`,
    )
    if (buffer && input.reversed === true)
      reverseAudioBufferInPlace(buffer)
    return buffer
  }
  finally {
    handle.dispose()
  }
}

/** Mix every audible segment into one buffer on an offline 48kHz stereo bus. */
async function renderAudioMix(protocol: IVideoProtocol, durationMs: number, signal?: AbortSignal): Promise<AudioBuffer | undefined> {
  const inputs = createComposeAudioInputs(protocol)
  if (!inputs.length)
    return undefined
  const lengthFrames = Math.ceil(durationMs / 1000 * MIX_SAMPLE_RATE)
  if (lengthFrames <= 0)
    return undefined

  const ctx = new OfflineAudioContext(2, lengthFrames, MIX_SAMPLE_RATE)
  let scheduled = 0

  const settled = await Promise.allSettled(inputs.map(async (input) => {
    const buffer = await decodeInputAudioSlice(input, signal)
    if (!buffer)
      return

    const playRate = normalizePlayRate(input.playRate)
    const volume = normalizeVolume(input.volume)
    const startSec = Math.max(0, input.startTime) / 1000
    const segmentDurationSec = Math.max(0, input.endTime - input.startTime) / 1000
    const endSec = startSec + segmentDurationSec
    const fadeInSec = Math.max(0, Math.min(input.fadeInDuration ?? 0, input.endTime - input.startTime)) / 1000
    const fadeOutSec = Math.max(0, Math.min(input.fadeOutDuration ?? 0, input.endTime - input.startTime)) / 1000

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = playRate

    const gainNode = ctx.createGain()
    const fadeEnvelopeAt = (relSec: number) => {
      let envelope = 1
      if (fadeInSec > 0 && relSec < fadeInSec)
        envelope = Math.max(0, relSec / fadeInSec)
      const untilEndSec = segmentDurationSec - relSec
      if (fadeOutSec > 0 && untilEndSec < fadeOutSec)
        envelope = Math.min(envelope, Math.max(0, untilEndSec / fadeOutSec))
      return envelope
    }
    if (input.volumeKeyframes?.length) {
      // Sample the keyframed volume curve (x fade envelope) on a fixed grid.
      const curveOffsetMs = Math.max(0, input.startTime - (input.segmentStartTime ?? input.startTime))
      const stepSec = 0.05
      gainNode.gain.setValueAtTime(
        normalizeVolume(sampleFrames(input.volumeKeyframes, curveOffsetMs)) * fadeEnvelopeAt(0),
        startSec,
      )
      for (let relSec = stepSec; relSec < segmentDurationSec + stepSec; relSec += stepSec) {
        const clampedRelSec = Math.min(relSec, segmentDurationSec)
        const curveValue = normalizeVolume(sampleFrames(input.volumeKeyframes, curveOffsetMs + clampedRelSec * 1000))
        gainNode.gain.linearRampToValueAtTime(curveValue * fadeEnvelopeAt(clampedRelSec), startSec + clampedRelSec)
        if (clampedRelSec >= segmentDurationSec)
          break
      }
    }
    else {
      if (fadeInSec > 0) {
        gainNode.gain.setValueAtTime(0, startSec)
        gainNode.gain.linearRampToValueAtTime(volume, startSec + fadeInSec)
      }
      else {
        gainNode.gain.setValueAtTime(volume, startSec)
      }
      if (fadeOutSec > 0) {
        gainNode.gain.setValueAtTime(volume, Math.max(startSec, endSec - fadeOutSec))
        gainNode.gain.linearRampToValueAtTime(0, endSec)
      }
    }

    source.connect(gainNode)
    gainNode.connect(ctx.destination)
    source.start(startSec)
    source.stop(endSec)
    scheduled += 1
  }))

  // A track the caller asked for that cannot be loaded must fail the export.
  // Silently dropping it produces a file that plays, so nobody notices the
  // missing audio until it ships. A source with no audio track at all is a
  // different case: `decodeInputAudioSlice` returns undefined and we skip it.
  throwIfAborted(signal, 'mixing audio')
  const failure = settled.find(item => item.status === 'rejected')
  if (failure?.status === 'rejected') {
    const reason = failure.reason
    if (reason instanceof Error && reason.name === 'AbortError')
      throw reason
    throw new Error(
      `composeProtocol: audio input failed to load; pass audio: false to export without audio (${reason instanceof Error ? reason.message : String(reason)})`,
      { cause: reason },
    )
  }

  if (!scheduled)
    return undefined
  return await ctx.startRendering()
}

export async function composeProtocol(
  protocol: IVideoProtocol,
  opts: ComposeProtocolOptions = {},
): Promise<ComposeProtocolResult> {
  const { onProgress, clipOptions } = opts

  const width = opts.width ?? protocol.width
  const height = opts.height ?? protocol.height
  if (!width || !height)
    throw new Error('composeProtocol: output width/height is required')

  const fps = opts.fps ?? protocol.fps ?? 30

  // Fail before decoding or rendering anything: discovering a missing codec
  // halfway through a long export costs the user the whole run.
  const unsupported = await checkEncoderSupport({
    format: opts.format,
    videoCodec: opts.videoCodec,
    width,
    height,
    withAudio: opts.audio !== false,
  })
  if (unsupported)
    throw new Error(`composeProtocol: ${unsupported}`)

  throwIfAborted(opts.signal, 'starting up')

  const renderProtocol = await resolveProtocolAssetUrls(
    protocol,
    clipOptions?.rendererOptions?.resolveAssetUrl,
  )
  throwIfAborted(opts.signal, 'resolving assets')

  const app = new Application()
  await app.init({
    width,
    height,
    backgroundAlpha: 0,
    ...clipOptions?.appOptions,
  })
  app.ticker.stop()

  let renderer: Awaited<ReturnType<typeof createRenderer>> | undefined
  let rendererDestroyed = false
  const destroyRenderer = () => {
    if (rendererDestroyed)
      return
    rendererDestroyed = true
    renderer?.destroy()
    app.destroy(true)
  }

  try {
    const rendererOptions = { ...clipOptions?.rendererOptions }
    delete rendererOptions.resolveAssetUrl
    renderer = await createRenderer({
      protocol: renderProtocol,
      app,
      warmUpResources: false,
      ...rendererOptions,
      autoPlay: false,
      freezeOnPause: false,
      manualRender: true,
    })

    throwIfAborted(opts.signal, 'preparing the renderer')

    const durationMs = renderer.duration.value
    if (!durationMs)
      throw new Error('composeProtocol: protocol has no duration')

    const audioBuffer = opts.audio === false
      ? undefined
      : await renderAudioMix(renderProtocol, durationMs, opts.signal)

    throwIfAborted(opts.signal, 'preparing the encoder')

    const encoder = createEncoder({
      format: opts.format,
      canvas: app.canvas,
      videoCodec: opts.videoCodec,
      videoBitrate: opts.bitrate,
      withAudio: !!audioBuffer,
      audioBitrate: opts.audioBitrate,
    })

    let cancelled = false
    const totalFrames = Math.max(1, Math.ceil(durationMs / 1000 * fps))
    const frameDurationMs = 1000 / fps

    let settleCompletion: () => void = () => {}
    let failCompletion: (reason: Error) => void = () => {}
    const completion = new Promise<void>((resolve, reject) => {
      settleCompletion = resolve
      failCompletion = reject
    })
    // Nobody is required to await `completion`; without this an export that
    // fails while the caller only reads the stream would surface as an
    // unhandled rejection.
    completion.catch(() => {})

    void (async () => {
      try {
        if (audioBuffer)
          await encoder.setAudio(audioBuffer)
        for (let i = 0; i < totalFrames; i++) {
          if (cancelled)
            return
          const timestampMs = i * frameDurationMs
          await renderer!.renderAt(Math.min(timestampMs, durationMs))
          await encoder.addFrame(timestampMs, frameDurationMs)
          onProgress?.(Math.min(0.95, ((i + 1) / totalFrames) * 0.95))
        }
        await encoder.finalize()
        onProgress?.(1)
        settleCompletion()
      }
      catch (err) {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error(String(err))
          // Error the stream rather than closing it: a consumer reading only
          // the stream must not end up with a truncated file it believes is
          // complete.
          await encoder.abort(error).catch(() => {})
          failCompletion(error)
        }
      }
      finally {
        destroyRenderer()
      }
    })()

    const destroy = () => {
      if (cancelled)
        return
      cancelled = true
      const error = abortError('composeProtocol: export was cancelled')
      void encoder.abort(error).catch(() => {})
      failCompletion(error)
      destroyRenderer()
      opts.signal?.removeEventListener('abort', destroy)
    }

    // An abort raised after the encode loop started stops it at the next frame.
    if (opts.signal?.aborted)
      destroy()
    else
      opts.signal?.addEventListener('abort', destroy)

    return {
      stream: encoder.stream,
      width,
      height,
      durationMs,
      mimeType: encoder.mimeType,
      fileExtension: encoder.fileExtension,
      completion,
      destroy,
    }
  }
  catch (err) {
    destroyRenderer()
    throw err
  }
}
