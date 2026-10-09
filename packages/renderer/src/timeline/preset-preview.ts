import type { Filter } from 'pixi.js'
import type { EffectDefinition } from './effect-registry'
import type { TransitionDefinition } from './transition-registry'
import type { VisualEffectParam } from './types'
import { Application, Sprite, Texture } from 'pixi.js'
import { buildEffectFilters } from './effect-registry'
import { buildTransitionFilters, updateTransitionFilters } from './transition-registry'

export type PresetPreviewDefinition = EffectDefinition | TransitionDefinition
export type PresetPreviewKind = 'filter' | 'effect' | 'transition'

export interface PresetPreviewOptions {
  canvas: HTMLCanvasElement
  width?: number
  height?: number
  source?: CanvasImageSource
  target?: CanvasImageSource
}

export interface PresetPreviewRenderOptions {
  kind: PresetPreviewKind
  intensity?: number
  progress?: number
  timeMs?: number
  /** Defaults to true for effects and transitions. Set false for a still frame. */
  animate?: boolean
}

export interface PresetPreview {
  readonly canvas: HTMLCanvasElement
  render: (definition: PresetPreviewDefinition, options: PresetPreviewRenderOptions) => void
  start: () => void
  stop: () => void
  destroy: () => void
}

/** A preview owns its textures and filters, but never the caller's canvas. */
export async function createPresetPreview(options: PresetPreviewOptions): Promise<PresetPreview> {
  const width = options.width ?? 640
  const height = options.height ?? 360
  const app = new Application()
  await app.init({ canvas: options.canvas, width, height, preference: 'webgl', backgroundAlpha: 0, autoStart: false })
  const textures = [
    Texture.from(createPreviewSource(width, height, false, options.source)),
    Texture.from(createPreviewSource(width, height, true, options.target)),
  ]
  const from = new Sprite(textures[0])
  const to = new Sprite(textures[1])
  app.stage.addChild(from, to)
  let disposeActive: (() => void) | undefined
  let draw: ((elapsed: number) => void) | undefined
  let frame: number | undefined
  let destroyed = false
  let elapsed = 0
  let lastTime: number | undefined

  function stop() {
    if (frame !== undefined)
      cancelAnimationFrame(frame)
    frame = undefined
    lastTime = undefined
  }

  function tick(now: number) {
    frame = undefined
    if (destroyed || !draw)
      return
    if (lastTime !== undefined)
      elapsed += now - lastTime
    lastTime = now
    draw(elapsed)
    frame = requestAnimationFrame(tick)
  }

  function start() {
    if (destroyed)
      throw new Error('[renderer] preset preview is destroyed')
    if (draw && frame === undefined)
      frame = requestAnimationFrame(tick)
  }

  function release(definition: PresetPreviewDefinition, filters: Filter[]) {
    if (definition.dispose)
      definition.dispose(filters)
    else
      filters.forEach(filter => filter.destroy())
  }

  function render(definition: PresetPreviewDefinition, settings: PresetPreviewRenderOptions) {
    if (destroyed)
      throw new Error('[renderer] preset preview is destroyed')
    stop()
    from.filters = to.filters = null
    disposeActive?.()
    disposeActive = undefined
    draw = undefined
    elapsed = settings.timeMs ?? 0
    to.visible = settings.kind === 'transition'
    if (settings.kind === 'transition') {
      const transition = definition as TransitionDefinition
      const outgoing = buildTransitionFilters(transition, 'from')
      const incoming = buildTransitionFilters(transition, 'to')
      from.filters = outgoing
      to.filters = incoming
      disposeActive = () => {
        release(transition, outgoing)
        release(transition, incoming)
      }
      draw = (timeMs) => {
        const progress = settings.progress ?? Math.min((timeMs % 2200) / 1600, 1)
        updateTransitionFilters(transition, outgoing, { timeMs, progress, role: 'from' })
        updateTransitionFilters(transition, incoming, { timeMs, progress, role: 'to' })
        app.render()
      }
    }
    else {
      const effect = definition as EffectDefinition
      const param: VisualEffectParam = settings.kind === 'filter'
        ? { segmentType: 'filter', segmentId: 'preset-preview', filterId: effect.id, name: effect.label, intensity: settings.intensity ?? 0.8 }
        : { segmentType: 'effect', segmentId: 'preset-preview', effectId: effect.id, name: effect.label }
      const filters = buildEffectFilters(effect, param)
      from.filters = filters
      disposeActive = () => release(effect, filters)
      draw = (timeMs) => {
        // Repeat short effects such as shockwaves, independent of page uptime.
        effect.update?.(filters, param, { timeMs: timeMs % 3000, sourceTimeMs: timeMs % 3000 })
        app.render()
      }
    }
    draw(elapsed)
    if (settings.animate ?? settings.kind !== 'filter')
      start()
  }

  return {
    canvas: options.canvas,
    render,
    start,
    stop,
    destroy() {
      if (destroyed)
        return
      destroyed = true
      stop()
      from.filters = to.filters = null
      disposeActive?.()
      draw = undefined
      app.destroy(false, { children: true })
      textures.forEach(texture => texture.destroy(true))
    },
  }
}

function createPreviewSource(width: number, height: number, target: boolean, image?: CanvasImageSource): HTMLCanvasElement {
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const context = source.getContext('2d')
  if (!context)
    throw new Error('[renderer] failed to create a preset preview source canvas')
  if (image) {
    context.drawImage(image, 0, 0, width, height)
    return source
  }
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, target ? '#064e3b' : '#1e3a8a')
  gradient.addColorStop(1, target ? '#fbbf24' : '#e879a4')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#fef3c7'
  context.beginPath()
  context.arc(width * (target ? 0.28 : 0.72), height * 0.32, height * 0.16, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = target ? '#115e59' : '#312e81'
  context.beginPath()
  context.moveTo(0, height)
  context.lineTo(width * 0.3, height * 0.35)
  context.lineTo(width * 0.65, height * 0.85)
  context.lineTo(width, height * 0.45)
  context.lineTo(width, height)
  context.fill()
  return source
}
