import { describe, expect, it } from 'vitest'
import {
  buildTrackMetrics,
  trackGapIndexAtY,
  trackHeightAt,
  trackIndexAtY,
  trackTopAt,
} from './metrics'

describe('buildTrackMetrics', () => {
  it('matches the old uniform-height arithmetic', () => {
    const gap = 2
    const height = 56
    const metrics = buildTrackMetrics({ heights: Array.from({ length: 4 }, () => height), gap })

    // Previously: index * (height + gap) + gap
    for (let i = 0; i < 4; i++)
      expect(metrics.tops[i]).toBe(i * (height + gap) + gap)
  })

  it('stacks mixed heights without drift', () => {
    const metrics = buildTrackMetrics({ heights: [56, 56, 48, 48], gap: 2 })

    expect(metrics.tops).toEqual([2, 60, 118, 168])
    expect(metrics.totalHeight).toBe(218)
  })

  it('clamps negative and non-finite input', () => {
    const metrics = buildTrackMetrics({ heights: [-10, Number.NaN, 40], gap: -4 })

    expect(metrics.gap).toBe(0)
    expect(metrics.heights).toEqual([0, 0, 40])
    expect(metrics.tops).toEqual([0, 0, 0])
  })
})

describe('trackTopAt / trackHeightAt', () => {
  const metrics = buildTrackMetrics({ heights: [56, 48], gap: 2 })

  it('reads back row geometry', () => {
    expect(trackTopAt(metrics, 0)).toBe(2)
    expect(trackTopAt(metrics, 1)).toBe(60)
    expect(trackHeightAt(metrics, 0)).toBe(56)
    expect(trackHeightAt(metrics, 1)).toBe(48)
  })

  it('falls back for out-of-range indices', () => {
    expect(trackTopAt(metrics, -1)).toBe(2)
    expect(trackTopAt(metrics, 9)).toBe(metrics.totalHeight)
    expect(trackHeightAt(metrics, 9)).toBe(48)
  })

  it('handles an empty timeline', () => {
    const empty = buildTrackMetrics({ heights: [], gap: 2 })
    expect(trackHeightAt(empty, 0)).toBe(0)
    expect(empty.totalHeight).toBe(2)
  })
})

describe('trackIndexAtY', () => {
  const metrics = buildTrackMetrics({ heights: [56, 48, 48], gap: 2 })

  it('resolves a point inside each row', () => {
    expect(trackIndexAtY(metrics, 10)).toBe(0)
    expect(trackIndexAtY(metrics, 80)).toBe(1)
    expect(trackIndexAtY(metrics, 130)).toBe(2)
  })

  it('assigns a gap to the row that follows it', () => {
    // Row 0 spans 2..58, the gap is 58..60.
    expect(trackIndexAtY(metrics, 59)).toBe(0)
    expect(trackIndexAtY(metrics, 60)).toBe(1)
  })

  it('reports -1 above the first row and clamps below the last', () => {
    expect(trackIndexAtY(metrics, -1)).toBe(-1)
    expect(trackIndexAtY(metrics, 10_000)).toBe(2)
  })

  it('would have been wrong under uniform-height math', () => {
    // The old formula floor(y / (56 + 2)) puts y=130 on row 2 only by accident;
    // at y=112 it says row 1 while the real row 2 starts at 110.
    expect(Math.floor(112 / 58)).toBe(1)
    expect(trackIndexAtY(metrics, 112)).toBe(2)
  })
})

describe('trackGapIndexAtY', () => {
  const metrics = buildTrackMetrics({ heights: [56, 48], gap: 2 })

  it('detects the leading gap', () => {
    expect(trackGapIndexAtY(metrics, 0)).toBe(0)
  })

  it('detects the gap between two rows of different heights', () => {
    // Row 0 ends at 58; the band is 57..61.
    expect(trackGapIndexAtY(metrics, 58)).toBe(1)
    expect(trackGapIndexAtY(metrics, 30)).toBeNull()
  })

  it('detects the trailing gap after the last row', () => {
    expect(trackGapIndexAtY(metrics, 108)).toBe(2)
  })
})
