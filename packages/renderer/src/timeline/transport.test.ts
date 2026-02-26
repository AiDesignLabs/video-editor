import { describe, expect, it, vi } from 'vitest'
import { createTimelineTransport } from './transport'

describe('timeline transport', () => {
  it('advances timeline while playing and freezes when paused', () => {
    const transport = createTimelineTransport({ initialTimelineMs: 100, initialRate: 1 })

    transport.play(1000)
    expect(transport.getSnapshot(1200).timelineMs).toBeCloseTo(300, 6)

    transport.pause(1200)
    expect(transport.getSnapshot(1600).timelineMs).toBeCloseTo(300, 6)
  })

  it('keeps timeline continuity when playback rate changes', () => {
    const transport = createTimelineTransport({ initialTimelineMs: 0, initialRate: 1 })

    transport.play(100)
    expect(transport.getSnapshot(150).timelineMs).toBeCloseTo(50, 6)

    transport.setRate(2, 150)
    expect(transport.getSnapshot(200).timelineMs).toBeCloseTo(150, 6)
  })

  it('bumps discontinuity sequence on seek and setRate', () => {
    const transport = createTimelineTransport({ initialTimelineMs: 0, initialRate: 1 })

    expect(transport.getSnapshot(0).discontinuitySeq).toBe(0)
    transport.seek(500, 100)
    expect(transport.getSnapshot(100).discontinuitySeq).toBe(1)
    transport.setRate(1.5, 120)
    expect(transport.getSnapshot(120).discontinuitySeq).toBe(2)
  })

  it('notifies subscribers on state updates', () => {
    const transport = createTimelineTransport({ initialTimelineMs: 0 })
    const listener = vi.fn()
    const unsubscribe = transport.subscribe(listener)

    transport.play(0)
    transport.seek(100, 10)
    unsubscribe()
    transport.pause(20)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[0]?.[0].playing).toBe(true)
    expect(listener.mock.calls[1]?.[0].timelineMs).toBe(100)
  })
})
