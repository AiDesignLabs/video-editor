import type { IVideoProtocol } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createComposeRunner } from './compose-runner'

function createProtocol(): IVideoProtocol {
  return {
    id: 'compose-runner-test',
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
            startTime: 100,
            endTime: 1000,
          },
        ],
      },
    ],
  }
}

describe('compose runner', () => {
  it('emits start and stop across deterministic sequence evaluation', () => {
    const protocol = createProtocol()
    const runner = createComposeRunner()

    const plans = runner.evaluateSequence(protocol, [0, 100, 500, 1000])
    const eventActions = plans.map(plan => plan.audioEvents.map(event => event.action))

    expect(eventActions[0]).toEqual([])
    expect(eventActions[1]).toContain('start')
    expect(eventActions[2]).not.toContain('start')
    expect(eventActions[3]).toContain('stop')
  })

  it('treats backward evaluation as discontinuity and emits seek', () => {
    const protocol = createProtocol()
    const runner = createComposeRunner()

    runner.evaluateAt(protocol, 200)
    runner.evaluateAt(protocol, 300)
    const back = runner.evaluateAt(protocol, 250)

    expect(back.audioEvents.map(event => event.action)).toContain('seek')
  })

  it('reset clears runner state and restarts voices', () => {
    const protocol = createProtocol()
    const runner = createComposeRunner()

    runner.evaluateAt(protocol, 200)
    expect(runner.getState().activeVoices.length).toBe(1)

    runner.reset()
    expect(runner.getState().activeVoices.length).toBe(0)

    const plan = runner.evaluateAt(protocol, 220)
    expect(plan.audioEvents.map(event => event.action)).toContain('start')
  })
})
