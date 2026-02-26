import type { IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import type { VisualPlanItem } from './types'
import { describe, expect, it } from 'vitest'
import { createVisualRenderItems } from './visual-plan'

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

function createProtocol(segments: IVideoFramesSegment[]): IVideoProtocol {
  return {
    id: 'visual-plan-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'frames-main',
        trackType: 'frames',
        isMain: true,
        children: segments,
      },
    ],
  }
}

describe('createVisualRenderItems', () => {
  it('adds transition overlay item with mapped source time and muted audio', () => {
    const fromSegment = createVideoSegment('video-1', 0, 1000)
    const toSegment = createVideoSegment('video-2', 1000, 2000, {
      fromTime: 50,
      playRate: 2,
      opacity: 0.8,
    })
    const protocol = createProtocol([fromSegment, toSegment])
    const visuals: VisualPlanItem[] = [
      {
        segmentId: 'video-1',
        trackId: 'frames-main',
        trackType: 'frames',
        segmentType: 'frames',
        zOrder: 1,
        sourceTimeMs: 900,
        opacity: 1,
        transition: {
          fromSegmentId: 'video-1',
          toSegmentId: 'video-2',
          progress: 0.5,
          durationMs: 200,
          transitionId: 't1',
          transitionName: 'crossfade',
        },
      },
    ]

    const items = createVisualRenderItems(protocol, visuals)
    expect(items).toHaveLength(2)
    expect(items[0]?.segment.id).toBe('video-1')
    expect(items[0]?.opacity).toBeCloseTo(0.5, 6)
    expect(items[0]?.includeAudio).toBe(true)

    expect(items[1]?.segment.id).toBe('video-2')
    expect(items[1]?.sourceTimeMs).toBeCloseTo(250, 6)
    expect(items[1]?.opacity).toBeCloseTo(0.4, 6)
    expect(items[1]?.includeAudio).toBe(false)
  })

  it('does not duplicate transition target when already active in visuals', () => {
    const fromSegment = createVideoSegment('video-1', 0, 1000)
    const toSegment = createVideoSegment('video-2', 900, 2000)
    const protocol = createProtocol([fromSegment, toSegment])
    const visuals: VisualPlanItem[] = [
      {
        segmentId: 'video-1',
        trackId: 'frames-main',
        trackType: 'frames',
        segmentType: 'frames',
        zOrder: 1,
        sourceTimeMs: 900,
        opacity: 1,
        transition: {
          fromSegmentId: 'video-1',
          toSegmentId: 'video-2',
          progress: 0.5,
          durationMs: 200,
        },
      },
      {
        segmentId: 'video-2',
        trackId: 'frames-main',
        trackType: 'frames',
        segmentType: 'frames',
        zOrder: 2,
        sourceTimeMs: 10,
        opacity: 1,
      },
    ]

    const items = createVisualRenderItems(protocol, visuals)
    expect(items.map(item => item.segment.id)).toEqual(['video-1', 'video-2'])
  })
})
