import type { EncoderFormat, Mp4VideoCodec } from '@video-editor/media'
import type { IVideoProtocol } from '@video-editor/shared'
import type { ApplicationOptions } from 'pixi.js'
import type { RendererOptions } from './renderer-core'
import type { ComposeAudioInput } from './timeline'
import { createEncoder, openMediaInput } from '@video-editor/media'
import { Application } from 'pixi.js'
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
}

export interface ComposeProtocolResult {
  stream: ReadableStream<Uint8Array>
  width: number
  height: number
  durationMs: number
  /** Container mime type of `stream`, e.g. `video/mp4`. */
  mimeType: string
  /** Container file extension including the dot, e.g. `.mp4`. */
  fileExtension: string
  destroy: () => void
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

function normalizePlayRate(playRate?: number): number {
  if (typeof playRate !== 'number' || !Number.isFinite(playRate))
    return 1
  return Math.max(0.1, Math.min(100, playRate))
}

async function fetchBlob(url: string, timeoutMs: number = RESOURCE_TIMEOUT_MS): Promise<Blob> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return await response.blob()
  }
  catch (err) {
    if (controller.signal.aborted)
      throw new Error(`composeProtocol: loading resource timed out (${timeoutMs}ms): ${url}`)
    throw err
  }
  finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function decodeInputAudioSlice(input: ComposeAudioInput): Promise<AudioBuffer | undefined> {
  const blob = await fetchBlob(input.url)
  const handle = openMediaInput(blob)
  try {
    if (!(await handle.canDecodeAudio()))
      return undefined
    const playRate = normalizePlayRate(input.playRate)
    const fromTimeMs = Math.max(0, input.fromTime ?? 0)
    const spanMs = Math.max(0, input.endTime - input.startTime) * playRate
    if (spanMs <= 0)
      return undefined
    return await withTimeout(
      handle.decodeAudioSlice(fromTimeMs, fromTimeMs + spanMs),
      RESOURCE_TIMEOUT_MS,
      `decode audio: ${input.url}`,
    )
  }
  finally {
    handle.dispose()
  }
}

/** Mix every audible segment into one buffer on an offline 48kHz stereo bus. */
async function renderAudioMix(protocol: IVideoProtocol, durationMs: number): Promise<AudioBuffer | undefined> {
  const inputs = createComposeAudioInputs(protocol)
  if (!inputs.length)
    return undefined
  const lengthFrames = Math.ceil(durationMs / 1000 * MIX_SAMPLE_RATE)
  if (lengthFrames <= 0)
    return undefined

  const ctx = new OfflineAudioContext(2, lengthFrames, MIX_SAMPLE_RATE)
  let scheduled = 0

  const settled = await Promise.allSettled(inputs.map(async (input) => {
    const buffer = await decodeInputAudioSlice(input)
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

  for (const item of settled) {
    if (item.status === 'rejected')
      console.error('[compose] skip audio input due to load failure', item.reason)
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
    renderer = await createRenderer({
      protocol,
      app,
      warmUpResources: false,
      ...clipOptions?.rendererOptions,
      autoPlay: false,
      freezeOnPause: false,
      manualRender: true,
    })

    const durationMs = renderer.duration.value
    if (!durationMs)
      throw new Error('composeProtocol: protocol has no duration')

    const audioBuffer = opts.audio === false
      ? undefined
      : await renderAudioMix(protocol, durationMs).catch((err) => {
          console.error('[compose] audio mix failed, composing without audio', err)
          return undefined
        })

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
      }
      catch (err) {
        if (!cancelled) {
          console.error('[compose] encoding failed', err)
          await encoder.cancel().catch(() => {})
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
      void encoder.cancel().catch(() => {})
      destroyRenderer()
    }

    return {
      stream: encoder.stream,
      width,
      height,
      durationMs,
      mimeType: encoder.mimeType,
      fileExtension: encoder.fileExtension,
      destroy,
    }
  }
  catch (err) {
    destroyRenderer()
    throw err
  }
}
