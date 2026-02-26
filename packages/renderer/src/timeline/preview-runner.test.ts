import type { IVideoProtocol } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createTimelineTransport } from './transport'
import { createPreviewRunner } from './preview-runner'

function createProtocol(): IVideoProtocol {
  return {
    id: 'preview-runner-test',
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

describe('preview runner', () => {
  it('emits seek event when transport discontinuity changes', () => {
    const transport = createTimelineTransport({ initialTimelineMs: 0 })
    const runner = createPreviewRunner({ transport })
    const protocol = createProtocol()

    const first = runner.evaluate(protocol, 100)
    expect(first.audioEvents.map(event => event.action)).toContain('start')

    transport.seek(500, 200)
    const second = runner.evaluate(protocol, 500)
    expect(second.audioEvents.map(event => event.action)).toContain('seek')
  })

  it('reset clears active state so next evaluate restarts voices', () => {
    const transport = createTimelineTransport({ initialTimelineMs: 0 })
    const runner = createPreviewRunner({ transport })
    const protocol = createProtocol()

    runner.evaluate(protocol, 100)
    expect(runner.getState().activeVoices.length).toBe(1)

    runner.reset()
    expect(runner.getState().activeVoices.length).toBe(0)

    const next = runner.evaluate(protocol, 120)
    expect(next.audioEvents.map(event => event.action)).toContain('start')
  })
})
