import type { IVideoProtocol } from '@video-editor/shared'
import type { IClip } from '@webav/av-cliper'
import type { ApplicationOptions } from 'pixi.js'
import { Application } from 'pixi.js'
import type { RendererOptions } from './renderer-core'
import { createRenderer } from './renderer-core'
import { computeDuration } from './helpers'

export interface ProtocolVideoClipOptions {
  width?: number
  height?: number
  fps?: number
  appOptions?: Partial<ApplicationOptions>
  rendererOptions?: Partial<Omit<RendererOptions, 'protocol' | 'app' | 'appOptions'>>
}

interface ClipMeta {
  width: number
  height: number
  duration: number
}

export class ProtocolVideoClip implements IClip {
  readonly ready: Promise<ClipMeta>
  meta: ClipMeta

  private readonly protocol: IVideoProtocol
  private readonly options: ProtocolVideoClipOptions
  private renderer?: Awaited<ReturnType<typeof createRenderer>>
  private app?: Application
  private destroyed = false

  constructor(protocol: IVideoProtocol, options: ProtocolVideoClipOptions = {}) {
    this.protocol = protocol
    this.options = options

    const width = options.width ?? protocol.width
    const height = options.height ?? protocol.height
    const durationMs = computeDuration(protocol)
    this.meta = {
      width,
      height,
      duration: Math.max(0, Math.round(durationMs * 1000)),
    }

    this.ready = this.init()
  }

  private async init() {
    const width = this.options.width ?? this.protocol.width
    const height = this.options.height ?? this.protocol.height
    if (!width || !height)
      throw new Error('ProtocolVideoClip: output width/height is required')

    const app = new Application()
    await app.init({
      width,
      height,
      backgroundAlpha: 0,
      ...this.options.appOptions,
    })
    app.ticker.stop()
    this.app = app

    const rendererOptions = this.options.rendererOptions ?? {}
    const renderer = await createRenderer({
      protocol: this.protocol,
      app,
      ...rendererOptions,
      autoPlay: false,
      freezeOnPause: false,
      manualRender: true,
      videoSourceMode: rendererOptions.videoSourceMode ?? 'mp4clip',
    })
    this.renderer = renderer

    const durationMs = renderer.duration.value
    this.meta = {
      width: app.renderer.width,
      height: app.renderer.height,
      duration: Math.max(0, Math.round(durationMs * 1000)),
    }

    return this.meta
  }

  async tick(time: number): Promise<{
    video?: VideoFrame | ImageBitmap | null
    audio?: Float32Array[]
    state: 'done' | 'success'
  }> {
    const emptyAudio: Float32Array[] = []
    if (this.destroyed)
      return { audio: emptyAudio, state: 'done' }

    await this.ready
    if (!this.renderer)
      return { audio: emptyAudio, state: 'done' }

    const durationUs = this.meta.duration
    if (time >= durationUs)
      return { audio: emptyAudio, state: 'done' }

    const clampedUs = Math.max(0, Math.min(time, durationUs))
    await this.renderer.renderAt(clampedUs / 1000)

    const frame = new VideoFrame(this.renderer.app.canvas, {
      timestamp: time,
    })

    return {
      video: frame,
      audio: emptyAudio,
      state: 'success',
    }
  }

  async clone(): Promise<this> {
    const copy = new ProtocolVideoClip(this.protocol, this.options) as this
    await copy.ready
    return copy
  }

  destroy() {
    if (this.destroyed)
      return
    this.destroyed = true
    this.renderer?.destroy()
    this.app?.destroy(true)
  }
}
