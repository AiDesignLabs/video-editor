import { describe, expect, it } from 'vitest'
import { mapSourceTimeMs, normalizePlayRate, sourceSpanMs } from './timing'

describe('normalizePlayRate', () => {
  it('defaults to 1 for missing or non-finite values', () => {
    expect(normalizePlayRate()).toBe(1)
    expect(normalizePlayRate(Number.NaN)).toBe(1)
    expect(normalizePlayRate(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('clamps into [0.1, 100]', () => {
    expect(normalizePlayRate(0)).toBe(0.1)
    expect(normalizePlayRate(-5)).toBe(0.1)
    expect(normalizePlayRate(1000)).toBe(100)
    expect(normalizePlayRate(2)).toBe(2)
  })
})

describe('sourceSpanMs', () => {
  it('scales the timeline duration by the play rate', () => {
    expect(sourceSpanMs({ startTime: 1000, endTime: 3000 })).toBe(2000)
    expect(sourceSpanMs({ startTime: 1000, endTime: 3000, playRate: 2 })).toBe(4000)
    expect(sourceSpanMs({ startTime: 3000, endTime: 1000 })).toBe(0)
  })
})

describe('mapSourceTimeMs (forward)', () => {
  it('maps relative timeline time through fromTime and rate', () => {
    const segment = { startTime: 1000, endTime: 3000, fromTime: 500, playRate: 2 }
    expect(mapSourceTimeMs(segment, 1000)).toBe(500)
    expect(mapSourceTimeMs(segment, 2000)).toBe(2500)
    expect(mapSourceTimeMs(segment, 3000)).toBe(4500)
  })

  it('clamps times before the segment start', () => {
    const segment = { startTime: 1000, endTime: 3000, fromTime: 500 }
    expect(mapSourceTimeMs(segment, 0)).toBe(500)
  })

  it('defaults fromTime and playRate', () => {
    expect(mapSourceTimeMs({ startTime: 0, endTime: 1000 }, 400)).toBe(400)
  })
})

describe('mapSourceTimeMs (reversed)', () => {
  it('reads the same source window backwards', () => {
    const segment = { startTime: 1000, endTime: 3000, fromTime: 500, reversed: true }
    expect(mapSourceTimeMs(segment, 1000)).toBe(2500)
    expect(mapSourceTimeMs(segment, 2000)).toBe(1500)
    expect(mapSourceTimeMs(segment, 3000)).toBe(500)
  })

  it('honours the play rate', () => {
    const segment = { startTime: 0, endTime: 1000, fromTime: 0, playRate: 2, reversed: true }
    expect(mapSourceTimeMs(segment, 0)).toBe(2000)
    expect(mapSourceTimeMs(segment, 500)).toBe(1000)
    expect(mapSourceTimeMs(segment, 1000)).toBe(0)
  })

  it('never falls below fromTime', () => {
    const segment = { startTime: 0, endTime: 1000, fromTime: 300, reversed: true }
    expect(mapSourceTimeMs(segment, 5000)).toBe(300)
  })
})
