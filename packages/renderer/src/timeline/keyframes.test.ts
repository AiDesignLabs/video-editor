import type { IKeyframeTrack, ITextSegment } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { cubicBezierEase, sampleKeyframes, sampleSegmentKeyframe, sampleVisualKeyframes } from './keyframes'

const opacityTrack: IKeyframeTrack = {
  property: 'opacity',
  frames: [
    { timeMs: 1000, value: 0 },
    { timeMs: 2000, value: 1 },
  ],
}

describe('sampleKeyframes', () => {
  it('interpolates linearly between frames', () => {
    expect(sampleKeyframes(opacityTrack, 1500)).toBeCloseTo(0.5, 6)
    expect(sampleKeyframes(opacityTrack, 1250)).toBeCloseTo(0.25, 6)
  })

  it('holds first and last values outside the range', () => {
    expect(sampleKeyframes(opacityTrack, 0)).toBe(0)
    expect(sampleKeyframes(opacityTrack, 5000)).toBe(1)
  })

  it('applies named easings on the outgoing edge', () => {
    const eased: IKeyframeTrack = {
      property: 'opacity',
      frames: [
        { timeMs: 0, value: 0, easing: 'easeIn' },
        { timeMs: 1000, value: 1 },
      ],
    }
    // easeIn starts slower than linear.
    expect(sampleKeyframes(eased, 250)).toBeLessThan(0.25)
    expect(sampleKeyframes(eased, 750)).toBeGreaterThan(0.5)
  })
})

describe('cubicBezierEase', () => {
  it('matches CSS reference values for ease-in-out', () => {
    // cubic-bezier(0.42, 0, 0.58, 1) at x=0.5 => 0.5 (symmetric)
    expect(cubicBezierEase(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 4)
    expect(cubicBezierEase(0.42, 0, 0.58, 1, 0)).toBe(0)
    expect(cubicBezierEase(0.42, 0, 0.58, 1, 1)).toBe(1)
    // linear control points reproduce identity
    expect(cubicBezierEase(1 / 3, 1 / 3, 2 / 3, 2 / 3, 0.37)).toBeCloseTo(0.37, 4)
  })
})

describe('sampleVisualKeyframes', () => {
  const segment: ITextSegment = {
    id: 't',
    segmentType: 'text',
    startTime: 1000,
    endTime: 3000,
    texts: [{ content: 'x' }],
    transform: { position: [0.5, 0, 0], rotation: [0, 0, 90], scale: [2, 2, 1] },
    keyframes: [
      { property: 'position.x', frames: [{ timeMs: 0, value: -1 }, { timeMs: 1000, value: 1 }] },
      { property: 'scale', frames: [{ timeMs: 0, value: 1 }, { timeMs: 1000, value: 3 }] },
    ],
  }

  it('keyframe times are relative to segment start', () => {
    const sampled = sampleVisualKeyframes(segment, 1500, segment.transform)
    expect(sampled.transform?.position[0]).toBeCloseTo(0, 6)
    expect(sampled.transform?.scale[0]).toBeCloseTo(2, 6)
    expect(sampled.transform?.scale[1]).toBeCloseTo(2, 6)
  })

  it('keeps non-keyframed axes from the base transform', () => {
    const sampled = sampleVisualKeyframes(segment, 1500, segment.transform)
    expect(sampled.transform?.rotation[2]).toBe(90)
    expect(sampled.transform?.position[1]).toBe(0)
  })

  it('does not mutate the base transform', () => {
    sampleVisualKeyframes(segment, 1500, segment.transform)
    expect(segment.transform?.position[0]).toBe(0.5)
    expect(segment.transform?.scale[0]).toBe(2)
  })

  it('returns empty when the segment has no keyframes', () => {
    const plain: ITextSegment = { ...segment, keyframes: undefined }
    expect(sampleVisualKeyframes(plain, 1500, plain.transform)).toEqual({})
  })

  it('sampleSegmentKeyframe returns undefined for missing tracks', () => {
    expect(sampleSegmentKeyframe(segment, 'volume', 1500)).toBeUndefined()
    expect(sampleSegmentKeyframe(segment, 'position.x', 1000)).toBe(-1)
  })
})
