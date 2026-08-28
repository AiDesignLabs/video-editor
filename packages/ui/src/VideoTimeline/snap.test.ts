import type { TimelineTrack } from './types'
import { describe, expect, it } from 'vitest'
import { collectSnapCandidates, quantizeToGrid, resolveSnapCandidates } from './snap'

function track(id: string, segments: Array<{ id: string, start: number, end: number }>): TimelineTrack {
  return { id, segments }
}

describe('resolveSnapCandidates', () => {
  it('returns null when nothing is within the threshold', () => {
    const result = resolveSnapCandidates(
      [{ time: 1000, guide: true }],
      0,
      500,
      50,
    )
    expect(result).toBeNull()
  })

  it('snaps the start edge to the closest candidate', () => {
    const result = resolveSnapCandidates(
      [{ time: 1000, guide: true }],
      1030,
      500,
      50,
    )
    expect(result?.time).toBe(1000)
    expect(result?.guideTimes).toEqual([1000])
  })

  it('snaps the end edge by shifting the start', () => {
    // End sits at 1520, a boundary at 1500 pulls the whole segment left by 20.
    const result = resolveSnapCandidates(
      [{ time: 1500, guide: true }],
      1020,
      500,
      50,
    )
    expect(result?.time).toBe(1000)
    expect(result?.guideTimes).toEqual([1500])
  })

  it('prefers the smallest absolute delta across both edges', () => {
    const result = resolveSnapCandidates(
      [
        { time: 960, guide: true }, // start delta -40
        { time: 1510, guide: true }, // end delta +10
      ],
      1000,
      500,
      50,
    )
    expect(result?.time).toBe(1010)
    expect(result?.guideTimes).toEqual([1510])
  })

  it('reports every candidate matched by the winning delta', () => {
    const result = resolveSnapCandidates(
      [
        { time: 990, guide: true }, // start delta -10
        { time: 1490, guide: true }, // end delta -10
      ],
      1000,
      500,
      50,
    )
    expect(result?.time).toBe(990)
    expect(result?.guideTimes).toEqual([990, 1490])
  })

  it('omits silent (grid) candidates from the guide list', () => {
    const result = resolveSnapCandidates(
      [{ time: 1000, guide: false }],
      1005,
      500,
      50,
    )
    expect(result?.time).toBe(1000)
    expect(result?.guideTimes).toEqual([])
  })

  it('prefers a boundary over a closer grid candidate', () => {
    const result = resolveSnapCandidates(
      [
        { time: 1005, guide: false }, // grid, delta +5
        { time: 1030, guide: true }, // boundary, delta +30
      ],
      1000,
      500,
      50,
    )
    expect(result?.time).toBe(1030)
    expect(result?.guideTimes).toEqual([1030])
  })

  it('falls back to a grid candidate when no boundary is in range', () => {
    const result = resolveSnapCandidates(
      [
        { time: 1005, guide: false },
        { time: 2000, guide: true },
      ],
      1000,
      100,
      50,
    )
    expect(result?.time).toBe(1005)
    expect(result?.guideTimes).toEqual([])
  })

  it('never resolves to a negative start', () => {
    const result = resolveSnapCandidates(
      [{ time: 0, guide: true }],
      10,
      500,
      50,
    )
    expect(result?.time).toBe(0)
  })

  it('only tests the start edge for a zero-length range', () => {
    const result = resolveSnapCandidates(
      [{ time: 1500, guide: true }],
      1020,
      0,
      50,
    )
    expect(result).toBeNull()
  })
})

describe('quantizeToGrid', () => {
  it('rounds to the nearest multiple', () => {
    expect(quantizeToGrid(1040, 100)).toBe(1000)
    expect(quantizeToGrid(1060, 100)).toBe(1100)
  })

  it('clamps to zero and tolerates a non-positive step', () => {
    expect(quantizeToGrid(-40, 100)).toBe(0)
    expect(quantizeToGrid(123.4, 0)).toBe(123.4)
  })
})

describe('collectSnapCandidates', () => {
  it('collects grid, origin, playhead and other segment boundaries', () => {
    const candidates = collectSnapCandidates({
      tracks: [track('t1', [
        { id: 'a', start: 0, end: 1000 },
        { id: 'dragged', start: 2000, end: 2500 },
      ])],
      rawStart: 2040,
      durationMs: 500,
      gridStepMs: 100,
      playheadMs: 3000,
      excludeId: 'dragged',
    })

    const guideTimes = candidates.filter(candidate => candidate.guide).map(candidate => candidate.time)
    expect(guideTimes).toEqual([0, 3000, 0, 1000])
    const gridTimes = candidates.filter(candidate => !candidate.guide).map(candidate => candidate.time)
    expect(gridTimes).toEqual([2000, 2500])
  })
})
