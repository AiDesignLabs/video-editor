import type { IVideoProtocol } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createPreviewAudioTicker } from './audio-ticker'
import { createPreviewRunner } from './preview-runner'
import { createTimelineTransport } from './transport'

function createProtocol(): IVideoProtocol {
  return {
    id: 'preview-audio-ticker-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: [
          {
            id: 'audio-1',
            segmentType: 'audio',
            url: 'https://example.com/audio.mp3',
            startTime: 0,
            endTime: 1000,
          },
        ],
      },
    ],
  }
}

describe('preview audio ticker', () => {
  it('runs immediate tick on start and continues on interval callbacks', () => {
    const protocol = createProtocol()
    let nowMs = 0
    const transport = createTimelineTransport({
      now: () => nowMs,
      initialTimelineMs: 0,
    })
    const runner = createPreviewRunner({ transport })

    let nextTimerId = 1
    const callbacks = new Map<number, () => void>()
    const intervals = new Map<number, number>()
    const setIntervalStub = (callback: () => void, intervalMs: number) => {
      const timerId = nextTimerId++
      callbacks.set(timerId, callback)
      intervals.set(timerId, intervalMs)
      return timerId as unknown as ReturnType<typeof setInterval>
    }
    const clearIntervalStub = (handle: ReturnType<typeof setInterval>) => {
      const timerId = Number(handle)
      callbacks.delete(timerId)
      intervals.delete(timerId)
    }

    const planAtMs: number[] = []
    const ticker = createPreviewAudioTicker({
      transport,
      runner,
      getProtocol: () => protocol,
      intervalMs: 25,
      setInterval: setIntervalStub,
      clearInterval: clearIntervalStub,
      onPlan: (plan) => {
        planAtMs.push(plan.atMs)
      },
    })

    transport.play(nowMs)
    ticker.start()

    expect(planAtMs).toEqual([0])
    expect(callbacks.size).toBe(1)
    const timerId = [...callbacks.keys()][0]
    expect(intervals.get(timerId)).toBe(25)

    nowMs = 25
    callbacks.get(timerId)?.()
    expect(planAtMs).toEqual([0, 25])

    ticker.stop()
    expect(callbacks.size).toBe(0)
    expect(ticker.isRunning()).toBe(false)
  })

  it('emits seek actions after transport discontinuity', () => {
    const protocol = createProtocol()
    let nowMs = 0
    const transport = createTimelineTransport({
      now: () => nowMs,
      initialTimelineMs: 0,
    })
    const runner = createPreviewRunner({ transport })
    const eventActions: string[][] = []
    const ticker = createPreviewAudioTicker({
      transport,
      runner,
      getProtocol: () => protocol,
      onPlan: (plan) => {
        eventActions.push(plan.audioEvents.map(event => event.action))
      },
    })

    transport.play(nowMs)
    ticker.tick()
    expect(eventActions[0]).toContain('start')

    nowMs = 500
    transport.seek(500, nowMs)
    ticker.tick()
    expect(eventActions[1]).toContain('seek')
  })
})
