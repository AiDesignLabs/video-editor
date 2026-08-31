import { describe, expect, it } from 'vitest'
import {
  gestureZoomFactor,
  MAX_PINCH_DELTA_Y,
  normalizeGestureScale,
  normalizeWheelDeltaY,
  pinchZoomFactor,
} from './zoom'

describe('normalizeWheelDeltaY', () => {
  it('passes pixel deltas through', () => {
    expect(normalizeWheelDeltaY({ deltaY: 42, deltaMode: 0 })).toBe(42)
  })

  it('scales line deltas, which Firefox reports instead of pixels', () => {
    expect(normalizeWheelDeltaY({ deltaY: 3, deltaMode: 1 })).toBe(48)
  })

  it('scales page deltas by the viewport height', () => {
    expect(normalizeWheelDeltaY({ deltaY: 2, deltaMode: 2 }, 900)).toBe(1800)
  })
})

describe('pinchZoomFactor', () => {
  it('is a no-op for a zero or invalid delta', () => {
    expect(pinchZoomFactor(0)).toBe(1)
    expect(pinchZoomFactor(Number.NaN)).toBe(1)
    expect(pinchZoomFactor(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('zooms in when pinching out (negative delta)', () => {
    expect(pinchZoomFactor(-50)).toBeGreaterThan(1)
  })

  it('zooms out when pinching in (positive delta)', () => {
    expect(pinchZoomFactor(50)).toBeLessThan(1)
  })

  it('is symmetric: opposite deltas cancel out', () => {
    expect(pinchZoomFactor(40) * pinchZoomFactor(-40)).toBeCloseTo(1, 10)
  })

  it('clamps momentum so one event cannot jump the whole range', () => {
    const atLimit = pinchZoomFactor(MAX_PINCH_DELTA_Y)
    expect(pinchZoomFactor(MAX_PINCH_DELTA_Y * 100)).toBe(atLimit)
    expect(pinchZoomFactor(-MAX_PINCH_DELTA_Y * 100)).toBe(pinchZoomFactor(-MAX_PINCH_DELTA_Y))
  })

  it('matches the shipped creatly constants', () => {
    // exp(-120 * 0.002) === exp(-0.24)
    expect(pinchZoomFactor(120)).toBeCloseTo(Math.exp(-0.24), 12)
  })
})

describe('gestureZoomFactor', () => {
  it('converts Safari cumulative scale into a per-event factor', () => {
    expect(gestureZoomFactor(1.5, 1)).toBeCloseTo(1.5, 10)
    expect(gestureZoomFactor(2.25, 1.5)).toBeCloseTo(1.5, 10)
  })

  it('composes back to the cumulative scale across a gesture', () => {
    const scales = [1.2, 1.44, 1.728]
    let last = 1
    let product = 1
    for (const scale of scales) {
      product *= gestureZoomFactor(scale, last)
      last = scale
    }
    expect(product).toBeCloseTo(scales[scales.length - 1], 10)
  })

  it('falls back to 1 for missing or nonsensical input', () => {
    expect(gestureZoomFactor(undefined, 1)).toBe(1)
    expect(gestureZoomFactor(-1, 1)).toBe(1)
    expect(gestureZoomFactor(1.5, 0)).toBe(1)
  })
})

describe('normalizeGestureScale', () => {
  it('keeps positive finite scales and rejects the rest', () => {
    expect(normalizeGestureScale(1.75)).toBe(1.75)
    expect(normalizeGestureScale(undefined)).toBe(1)
    expect(normalizeGestureScale(0)).toBe(1)
    expect(normalizeGestureScale(Number.NaN)).toBe(1)
  })
})
