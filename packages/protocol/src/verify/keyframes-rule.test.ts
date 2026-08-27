import type { IKeyframeTrack, SegmentUnion } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createValidator } from '.'

const keyframes: IKeyframeTrack[] = [
  {
    property: 'opacity',
    frames: [
      { timeMs: 0, value: 0 },
      { timeMs: 500, value: 1, easing: 'easeInOut' },
      { timeMs: 900, value: 0.5, easing: [0.42, 0, 0.58, 1] },
    ],
  },
]

// Every segment type must accept the optional keyframes field — a missing
// schema wiring would silently roll back keyframe edits for that type.
const segments: SegmentUnion[] = [
  { id: 's1', segmentType: 'frames', type: 'video', url: 'http://a.test/v.mp4', startTime: 0, endTime: 1000, keyframes },
  { id: 's2', segmentType: 'text', startTime: 0, endTime: 1000, texts: [{ content: 'x' }], keyframes },
  { id: 's3', segmentType: 'sticker', format: 'img', url: 'http://a.test/s.png', startTime: 0, endTime: 1000, keyframes },
  { id: 's4', segmentType: 'audio', url: 'http://a.test/a.mp3', startTime: 0, endTime: 1000, keyframes },
  { id: 's5', segmentType: 'effect', effectId: 'e', name: 'blur', startTime: 0, endTime: 1000, keyframes },
  { id: 's6', segmentType: 'filter', filterId: 'f', name: 'gray', startTime: 0, endTime: 1000, keyframes },
]

describe('keyframes validation', () => {
  const validator = createValidator()

  it.each(segments.map(segment => [segment.segmentType, segment] as const))(
    'accepts keyframes on %s segments',
    (_type, segment) => {
      expect(() => validator.verifySegment(segment)).not.toThrow()
    },
  )

  it('rejects unknown keyframe properties', () => {
    const invalid = {
      ...segments[1],
      keyframes: [{ property: 'nope', frames: [{ timeMs: 0, value: 1 }] }],
    }
    expect(() => validator.verifySegment(invalid as unknown as SegmentUnion)).toThrow()
  })

  it('rejects empty frame lists', () => {
    const invalid = {
      ...segments[1],
      keyframes: [{ property: 'opacity', frames: [] }],
    }
    expect(() => validator.verifySegment(invalid as unknown as SegmentUnion)).toThrow()
  })
})
