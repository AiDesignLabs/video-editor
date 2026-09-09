import { describe, expect, it } from 'vitest'
import { createPlaybackStatistics } from './playback-statistics'

describe('playback statistics', () => {
  it('counts completed frames, ignores duplicates, and reports a stalled window', () => {
    const stats = createPlaybackStatistics()
    stats.reset(0)
    for (let frame = 1; frame <= 24; frame++) {
      stats.record(frame, frame * 1000 / 24)
      stats.record(frame, frame * 1000 / 24 + 1)
    }
    expect(stats.sample(1000)).toEqual({ fps: 24, presentedFrames: 24, droppedFrames: 0 })
    expect(stats.sample(2100).fps).toBe(0)
  })

  it('counts skipped timeline frames without counting seeks as drops', () => {
    const stats = createPlaybackStatistics()
    stats.reset(0)
    stats.record(0, 10)
    stats.record(3, 100)
    stats.seek()
    stats.record(720, 200)
    expect(stats.sample(1000)).toEqual({ fps: 3, presentedFrames: 3, droppedFrames: 2 })
    stats.reset(1100)
    expect(stats.sample(1100)).toEqual({ fps: 0, presentedFrames: 0, droppedFrames: 0 })
  })
})
