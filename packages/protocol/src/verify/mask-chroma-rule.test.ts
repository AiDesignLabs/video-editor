import type { IChromaKey, IMask, SegmentUnion } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createValidator } from '.'

const mask: IMask = {
  shape: 'ellipse',
  center: [0.2, -0.1],
  size: [0.6, 0.4],
  feather: 0.15,
  rotation: 30,
  inverse: true,
}

const chromaKey: IChromaKey = {
  color: '#00ff00',
  similarity: 0.35,
  smoothness: 0.1,
  spillSuppress: 0.5,
}

// Only frames and sticker segments declare the fields; both must accept them.
const segments: SegmentUnion[] = [
  { id: 's1', segmentType: 'frames', type: 'video', url: 'http://a.test/v.mp4', startTime: 0, endTime: 1000, mask, chromaKey },
  { id: 's2', segmentType: 'sticker', format: 'img', url: 'http://a.test/s.png', startTime: 0, endTime: 1000, mask, chromaKey },
]

describe('mask / chromaKey validation', () => {
  const validator = createValidator()

  it.each(segments.map(segment => [segment.segmentType, segment] as const))(
    'accepts mask and chromaKey on %s segments',
    (_type, segment) => {
      expect(() => validator.verifySegment(segment)).not.toThrow()
    },
  )

  it('accepts a minimal mask without the optional fields', () => {
    const segment = { ...segments[0], mask: { shape: 'rect', center: [0, 0], size: [0.5, 0.5] }, chromaKey: undefined }
    expect(() => validator.verifySegment(segment as unknown as SegmentUnion)).not.toThrow()
  })

  it('rejects an unknown mask shape', () => {
    const segment = { ...segments[0], mask: { ...mask, shape: 'triangle' } }
    expect(() => validator.verifySegment(segment as unknown as SegmentUnion)).toThrow()
  })

  it('rejects a mask center that is not a 2-tuple', () => {
    const segment = { ...segments[1], mask: { ...mask, center: [0, 0, 0] } }
    expect(() => validator.verifySegment(segment as unknown as SegmentUnion)).toThrow()
  })

  it('rejects an out-of-range mask size', () => {
    const segment = { ...segments[0], mask: { ...mask, size: [1.5, 0.4] } }
    expect(() => validator.verifySegment(segment as unknown as SegmentUnion)).toThrow()
  })

  it('rejects a mask missing required fields', () => {
    const segment = { ...segments[0], mask: { shape: 'rect' } }
    expect(() => validator.verifySegment(segment as unknown as SegmentUnion)).toThrow()
  })

  it('rejects a non-hex chroma key color', () => {
    const segment = { ...segments[0], chromaKey: { ...chromaKey, color: 'green' } }
    expect(() => validator.verifySegment(segment as unknown as SegmentUnion)).toThrow()
  })

  it('rejects a chroma key similarity outside [0, 1]', () => {
    const segment = { ...segments[1], chromaKey: { ...chromaKey, similarity: 2 } }
    expect(() => validator.verifySegment(segment as unknown as SegmentUnion)).toThrow()
  })

  it('leaves other segment types unaffected', () => {
    const text: SegmentUnion = { id: 't1', segmentType: 'text', startTime: 0, endTime: 1000, texts: [{ content: 'x' }] }
    expect(() => validator.verifySegment(text)).not.toThrow()
  })
})
