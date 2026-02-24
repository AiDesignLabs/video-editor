import type { IAudioSegment, IVideoFramesSegment, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { IClip, ICombinatorOpts } from '@webav/av-cliper'
import { AudioClip, Combinator, MP4Clip, OffscreenSprite } from '@webav/av-cliper'
import { ProtocolVideoClip } from './protocol-clip'
import type { ProtocolVideoClipOptions } from './protocol-clip'

export interface ComposeProtocolOptions extends Omit<ICombinatorOpts, 'width' | 'height' | 'fps'> {
  width?: number
  height?: number
  fps?: number
  onProgress?: (progress: number) => void
  clipOptions?: ProtocolVideoClipOptions
  audioSprites?: (protocol: IVideoProtocol) => Promise<OffscreenSprite[]>
}

export interface ComposeProtocolResult {
  stream: ReadableStream<Uint8Array>
  width: number
  height: number
  durationMs: number
  destroy: () => void
}

interface ClipMeta {
  width: number
  height: number
  duration: number
}

interface SegmentAudioInput {
  startTime: number
  endTime: number
  fromTime?: number
  playRate?: number
  volume?: number
  fadeInDuration?: number
  fadeOutDuration?: number
}

interface SegmentAudioConfig {
  fromUs: number
  segmentDurationUs: number
  playRate: number
  baseVolume: number
  fadeInUs: number
  fadeOutUs: number
}

const RESOURCE_TIMEOUT_MS = 12000

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

class SegmentAudioClip implements IClip {
  readonly ready: Promise<ClipMeta>

  private clipMeta: ClipMeta = {
    width: 0,
    height: 0,
    duration: 0,
  }

  constructor(
    private readonly sourceClip: IClip,
    private readonly config: SegmentAudioConfig,
  ) {
    this.ready = this.sourceClip.ready.then((meta) => {
      const playbackDurationUs = Math.round(this.config.segmentDurationUs * this.config.playRate)
      const availableUs = Math.max(0, meta.duration - this.config.fromUs)
      this.clipMeta = {
        width: meta.width,
        height: meta.height,
        duration: Math.max(0, Math.min(playbackDurationUs, availableUs)),
      }
      return this.meta
    })
  }

  get meta() {
    return { ...this.clipMeta }
  }

  async tick(time: number): ReturnType<IClip['tick']> {
    const relativeSourceUs = Math.max(0, Math.round(time))
    const relativeTimelineUs = Math.round(relativeSourceUs / this.config.playRate)
    if (relativeTimelineUs >= this.config.segmentDurationUs) {
      return {
        audio: [],
        state: 'done',
      }
    }

    const sourceUs = this.config.fromUs + relativeSourceUs
    const result = await this.sourceClip.tick(sourceUs)
    closeFrame(result.video)

    const gain = this.resolveGain(relativeTimelineUs)
    return {
      audio: applyGain(result.audio ?? [], gain),
      state: result.state,
    }
  }

  async clone(): Promise<this> {
    const clonedSource = await this.sourceClip.clone()
    const copy = new SegmentAudioClip(clonedSource, this.config) as this
    await copy.ready
    return copy
  }

  destroy() {
    this.sourceClip.destroy()
  }

  private resolveGain(relativeTimelineUs: number): number {
    let volumeMultiplier = 1
    if (this.config.fadeInUs > 0 && relativeTimelineUs < this.config.fadeInUs)
      volumeMultiplier = Math.max(0, relativeTimelineUs / this.config.fadeInUs)

    const remainingUs = this.config.segmentDurationUs - relativeTimelineUs
    if (this.config.fadeOutUs > 0 && remainingUs < this.config.fadeOutUs)
      volumeMultiplier = Math.min(volumeMultiplier, Math.max(0, remainingUs / this.config.fadeOutUs))

    return this.config.baseVolume * volumeMultiplier
  }
}

function closeFrame(frame: unknown) {
  if (!frame || typeof frame !== 'object')
    return
  const maybeClose = (frame as { close?: unknown }).close
  if (typeof maybeClose === 'function')
    maybeClose.call(frame)
}

function applyGain(audio: Float32Array[], gain: number): Float32Array[] {
  if (!audio.length || gain >= 0.999)
    return audio

  if (gain <= 0)
    return audio.map(chan => new Float32Array(chan.length))

  return audio.map((chan) => {
    const out = new Float32Array(chan.length)
    for (let i = 0; i < chan.length; i++)
      out[i] = chan[i]! * gain
    return out
  })
}

function toUs(ms: number): number {
  if (!Number.isFinite(ms))
    return 0
  return Math.max(0, Math.round(ms * 1000))
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

function createSegmentAudioConfig(segment: SegmentAudioInput): SegmentAudioConfig {
  const durationMs = Math.max(0, segment.endTime - segment.startTime)
  const fadeInMs = Math.max(0, Math.min(segment.fadeInDuration ?? 0, durationMs))
  const fadeOutMs = Math.max(0, Math.min(segment.fadeOutDuration ?? 0, durationMs))
  return {
    fromUs: toUs(segment.fromTime ?? 0),
    segmentDurationUs: toUs(durationMs),
    playRate: normalizePlayRate(segment.playRate),
    baseVolume: normalizeVolume(segment.volume),
    fadeInUs: toUs(fadeInMs),
    fadeOutUs: toUs(fadeOutMs),
  }
}

function isAudioSegment(segment: SegmentUnion): segment is IAudioSegment {
  return segment.segmentType === 'audio'
}

function isVideoSegmentWithAudio(segment: SegmentUnion): segment is IVideoFramesSegment {
  return segment.segmentType === 'frames' && segment.type === 'video'
}

async function fetchReadable(url: string, timeoutMs: number = RESOURCE_TIMEOUT_MS): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.body)
      throw new Error(`composeProtocol: unable to read resource stream: ${url}`)
    return response.body
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

async function createSegmentAudioSprite(sourceClip: IClip, segment: SegmentAudioInput): Promise<OffscreenSprite> {
  const config = createSegmentAudioConfig(segment)
  const clip = new SegmentAudioClip(sourceClip, config)
  const sprite = new OffscreenSprite(clip)
  try {
    await withTimeout(sprite.ready, RESOURCE_TIMEOUT_MS, 'prepare audio sprite')
  }
  catch (err) {
    sprite.destroy()
    throw err
  }

  sprite.time.offset = toUs(segment.startTime)
  sprite.time.duration = config.segmentDurationUs
  sprite.time.playbackRate = config.playRate
  return sprite
}

async function createAudioSpriteFromAudioSegment(segment: IAudioSegment): Promise<OffscreenSprite> {
  const stream = await fetchReadable(segment.url)
  const sourceClip = new AudioClip(stream)
  return await createSegmentAudioSprite(sourceClip, segment)
}

async function createAudioSpriteFromVideoSegment(segment: IVideoFramesSegment): Promise<OffscreenSprite> {
  const stream = await fetchReadable(segment.url)
  const sourceClip = new MP4Clip(stream, { audio: true })
  return await createSegmentAudioSprite(sourceClip, segment)
}

async function createProtocolAudioSprites(protocol: IVideoProtocol): Promise<OffscreenSprite[]> {
  const tasks: Array<Promise<OffscreenSprite>> = []
  for (const track of protocol.tracks) {
    for (const child of track.children) {
      if (child.endTime <= child.startTime)
        continue

      if (isAudioSegment(child)) {
        if (normalizeVolume(child.volume) <= 0)
          continue
        tasks.push(createAudioSpriteFromAudioSegment(child))
        continue
      }

      if (isVideoSegmentWithAudio(child)) {
        if (normalizeVolume(child.volume) <= 0)
          continue
        tasks.push(createAudioSpriteFromVideoSegment(child))
      }
    }
  }

  if (!tasks.length)
    return []

  const settled = await Promise.allSettled(tasks)
  const sprites: OffscreenSprite[] = []
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      sprites.push(item.value)
      continue
    }
    console.warn('[compose] skip audio sprite due to load failure', item.reason)
  }
  return sprites
}

function destroySprites(sprites: OffscreenSprite[]) {
  for (const sprite of sprites)
    sprite.destroy()
}

function wrapStreamWithCleanup(
  stream: ReadableStream<Uint8Array>,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  let cleaned = false
  const finalize = () => {
    if (cleaned)
      return
    cleaned = true
    cleanup()
  }

  const reader = stream.getReader()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        finalize()
        controller.close()
        return
      }
      controller.enqueue(value)
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      }
      finally {
        finalize()
      }
    },
  })
}

export async function composeProtocol(
  protocol: IVideoProtocol,
  opts: ComposeProtocolOptions = {},
): Promise<ComposeProtocolResult> {
  const {
    width: requestedWidth,
    height: requestedHeight,
    fps: requestedFps,
    onProgress,
    clipOptions,
    audioSprites,
    ...combinatorOpts
  } = opts

  const width = requestedWidth ?? protocol.width
  const height = requestedHeight ?? protocol.height
  if (!width || !height)
    throw new Error('composeProtocol: output width/height is required')

  const fps = requestedFps ?? protocol.fps

  const resolvedAudioSprites = combinatorOpts.audio === false
    ? []
    : (typeof audioSprites === 'function'
        ? await audioSprites(protocol)
        : await createProtocolAudioSprites(protocol))

  const audio = combinatorOpts.audio ?? (resolvedAudioSprites.length > 0 ? undefined : false)
  const combinator = new Combinator({
    ...combinatorOpts,
    audio,
    width,
    height,
    fps,
  })

  if (onProgress)
    combinator.on('OutputProgress', onProgress)

  let clip: ProtocolVideoClip | undefined
  let sprite: OffscreenSprite | undefined
  try {
    clip = new ProtocolVideoClip(protocol, {
      width,
      height,
      fps,
      ...clipOptions,
      rendererOptions: {
        warmUpResources: false,
        ...clipOptions?.rendererOptions,
      },
    })
    await clip.ready

    sprite = new OffscreenSprite(clip)
    await sprite.ready
    sprite.time.offset = 0
    sprite.time.duration = clip.meta.duration
    sprite.rect.x = 0
    sprite.rect.y = 0
    sprite.rect.w = clip.meta.width
    sprite.rect.h = clip.meta.height

    await combinator.addSprite(sprite, { main: true })

    for (const extra of resolvedAudioSprites)
      await combinator.addSprite(extra)
  }
  catch (err) {
    destroySprites(resolvedAudioSprites)
    sprite?.destroy()
    clip?.destroy()
    combinator.destroy()
    throw err
  }

  const maxTime = clip?.meta.duration ?? 0
  if (!maxTime) {
    destroySprites(resolvedAudioSprites)
    sprite?.destroy()
    clip?.destroy()
    combinator.destroy()
    throw new Error('composeProtocol: protocol has no duration')
  }

  const stream = combinator.output({ maxTime })
  let destroyed = false
  const destroy = () => {
    if (destroyed)
      return
    destroyed = true
    destroySprites(resolvedAudioSprites)
    sprite?.destroy()
    clip?.destroy()
    combinator.destroy()
  }

  return {
    stream: wrapStreamWithCleanup(stream, destroy),
    width,
    height,
    durationMs: Math.round(maxTime / 1000),
    destroy,
  }
}
