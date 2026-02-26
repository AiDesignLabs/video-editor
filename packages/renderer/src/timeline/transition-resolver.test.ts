import type {
  IFramesSegmentUnion,
  ITransitionEdge,
  IVideoFramesSegment,
  IVideoProtocol,
} from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { collectTransitionByFromSegmentId } from './transition-resolver'

function createVideoSegment(
  id: string,
  startTime: number,
  endTime: number,
  overrides: Partial<IVideoFramesSegment> = {},
): IVideoFramesSegment {
  return {
    id,
    segmentType: 'frames',
    type: 'video',
    url: `https://example.com/${id}.mp4`,
    startTime,
    endTime,
    ...overrides,
  }
}

function createProtocol(input: {
  frames: IFramesSegmentUnion[]
  transitions?: ITransitionEdge[]
}): IVideoProtocol {
  return {
    id: 'transition-resolver-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'frames-main',
        trackType: 'frames',
        isMain: true,
        children: input.frames,
      },
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: [],
      },
    ],
    transitions: input.transitions,
  }
}

describe('transition resolver', () => {
  it('prefers explicit adjacent transition edges', () => {
    const protocol = createProtocol({
      frames: [
        createVideoSegment('video-1', 0, 1000),
        createVideoSegment('video-2', 1000, 2000),
      ],
      transitions: [{
        id: 'edge',
        name: 'edge',
        duration: 300,
        fromSegmentId: 'video-1',
        toSegmentId: 'video-2',
      }],
    })

    const map = collectTransitionByFromSegmentId(protocol)
    expect(map.get('video-1')?.id).toBe('edge')
    expect(map.get('video-1')?.duration).toBe(300)
  })

  it('drops explicit edges when segments are not adjacent', () => {
    const protocol = createProtocol({
      frames: [
        createVideoSegment('video-1', 0, 1000),
        createVideoSegment('video-2', 1000, 2000),
        createVideoSegment('video-3', 2000, 3000),
      ],
      transitions: [{
        id: 'edge',
        name: 'edge',
        duration: 300,
        fromSegmentId: 'video-1',
        toSegmentId: 'video-3',
      }],
    })

    const map = collectTransitionByFromSegmentId(protocol)
    expect(map.get('video-1')).toBeUndefined()
  })

  it('returns empty map when there is no explicit transition edge', () => {
    const protocol = createProtocol({
      frames: [
        createVideoSegment('video-1', 0, 1000),
        createVideoSegment('video-2', 1000, 2000),
      ],
    })

    const map = collectTransitionByFromSegmentId(protocol)
    expect(map.size).toBe(0)
  })
})
