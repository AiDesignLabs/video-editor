import type { IVideoProtocol } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createComposeAudioInputs } from './compose-audio-plan'

function createProtocol(): IVideoProtocol {
  return {
    id: 'compose-audio-plan-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'frames-main',
        trackType: 'frames',
        isMain: true,
        children: [
          {
            id: 'video-1',
            segmentType: 'frames',
            type: 'video',
            url: 'https://example.com/video-1.mp4',
            startTime: 500,
            endTime: 1500,
            fromTime: 200,
            playRate: 2,
            volume: 0.8,
          },
        ],
      },
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: [
          {
            id: 'audio-1',
            segmentType: 'audio',
            url: 'https://example.com/audio-1.mp3',
            startTime: 0,
            endTime: 1000,
            fromTime: 120,
            playRate: 1.5,
            volume: 0.9,
            fadeInDuration: 100,
            fadeOutDuration: 120,
          },
          {
            id: 'audio-muted',
            segmentType: 'audio',
            url: 'https://example.com/audio-muted.mp3',
            startTime: 200,
            endTime: 600,
            volume: 0,
          },
        ],
      },
    ],
  }
}

describe('createComposeAudioInputs', () => {
  it('builds compose audio inputs from evaluator voice events', () => {
    const protocol = createProtocol()
    const inputs = createComposeAudioInputs(protocol)

    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toMatchObject({
      segmentId: 'audio-1',
      segmentKind: 'audio',
      startTime: 0,
      endTime: 1000,
      fromTime: 120,
      playRate: 1.5,
      volume: 0.9,
      fadeInDuration: 100,
      fadeOutDuration: 120,
    })
    expect(inputs[1]).toMatchObject({
      segmentId: 'video-1',
      segmentKind: 'video',
      startTime: 500,
      endTime: 1500,
      fromTime: 200,
      playRate: 2,
      volume: 0.8,
    })
  })
})
