import type { PresetPreview } from './preset-preview'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listEffectDefinitions } from './effect-registry'
import { createPresetPreview } from './preset-preview'
import { BUILT_IN_TRANSITIONS } from './transitions'
import './pixi-effects'

let preview: PresetPreview | undefined
let nextFrame: FrameRequestCallback | undefined
let requests = 0

async function setup() {
  nextFrame = undefined
  requests = 0
  const canvas = document.createElement('canvas')
  preview = await createPresetPreview({ canvas, width: 160, height: 90 })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback
    return ++requests
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    nextFrame = undefined
  })
  return preview
}

function pixels(canvas: HTMLCanvasElement) {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const ctx = copy.getContext('2d')!
  ctx.drawImage(canvas, 0, 0)
  return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data)
}

function advance(time: number) {
  const callback = nextFrame
  nextFrame = undefined
  expect(callback).toBeDefined()
  callback!(time)
}

afterEach(() => {
  preview?.destroy()
  preview = undefined
  vi.restoreAllMocks()
})

describe('preset preview rendering', () => {
  it('animates visible pixels, reuses filters, and cancels frames on close', async () => {
    const p = await setup()
    const effect = listEffectDefinitions().find(item => item.id === 'rgb-split')!
    const update = vi.fn(effect.update!)
    const dispose = vi.fn(filters => filters.forEach((filter: { destroy: () => void }) => filter.destroy()))
    p.render({ ...effect, update, dispose }, { kind: 'effect' })
    const first = pixels(p.canvas)
    advance(50000)
    advance(50200)
    expect(pixels(p.canvas)).not.toEqual(first)
    expect(update.mock.calls[0][0][0]).toBe(update.mock.calls[2][0][0])
    expect(update.mock.calls[0][2].timeMs).toBe(0)
    expect(update.mock.calls[2][2].timeMs).toBe(200)
    p.destroy()
    p.destroy()
    expect(nextFrame).toBeUndefined()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('does not schedule animation for static filters and stops on switching', async () => {
    const p = await setup()
    p.render(listEffectDefinitions().find(item => item.id === 'film-grain')!, { kind: 'effect' })
    expect(nextFrame).toBeDefined()
    p.render(listEffectDefinitions().find(item => item.id === 'sharpen')!, { kind: 'filter' })
    expect(nextFrame).toBeUndefined()
  })

  it('renders both transition images and advances progress', async () => {
    const p = await setup()
    const transition = BUILT_IN_TRANSITIONS.find(item => item.id === 'wipe-right')!
    p.render(transition, { kind: 'transition' })
    const first = pixels(p.canvas)
    advance(10000)
    advance(10800)
    const middle = pixels(p.canvas)
    advance(11600)
    const last = pixels(p.canvas)
    expect(first).not.toEqual(middle)
    expect(middle).not.toEqual(last)
    expect(first.filter((_, i) => i % 4 === 3).every(value => value === 255)).toBe(true)
    expect(last.filter((_, i) => i % 4 === 3).every(value => value === 255)).toBe(true)
  })

  it('supports explicit still frames and stop/start', async () => {
    const p = await setup()
    p.render(listEffectDefinitions().find(item => item.id === 'film-grain')!, { kind: 'effect', animate: false, timeMs: 200 })
    expect(nextFrame).toBeUndefined()
    const first = pixels(p.canvas)
    p.start()
    advance(1000)
    advance(1300)
    expect(pixels(p.canvas)).not.toEqual(first)
    p.stop()
    expect(nextFrame).toBeUndefined()
  })
})
