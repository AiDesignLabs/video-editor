import type { SegmentLayout, SegmentResizePayload } from './types'
import { describe, expect, it } from 'vitest'
import { resolveResizePreviewGeometry } from './resize'

function createLayout(): SegmentLayout {
  const segment = { id: 'segment-1', start: 1000, end: 3000 }
  const track = { id: 'track-1', segments: [segment] }
  return {
    segment,
    track,
    trackIndex: 0,
    segmentIndex: 0,
    left: 100,
    width: 200,
    isSelected: true,
  }
}

function createPreview(layout: SegmentLayout, startTime: number, endTime: number): SegmentResizePayload {
  return {
    segment: layout.segment,
    track: layout.track,
    trackIndex: layout.trackIndex,
    segmentIndex: layout.segmentIndex,
    startTime,
    endTime,
    edge: startTime === layout.segment.start ? 'end' : 'start',
  }
}

describe('resolveResizePreviewGeometry', () => {
  it('keeps the original geometry without a matching preview', () => {
    const layout = createLayout()
    const otherPreview = createPreview(layout, 1000, 4000)
    otherPreview.segment = { ...layout.segment, id: 'segment-2' }

    expect(resolveResizePreviewGeometry(layout, null)).toEqual({ left: 100, width: 200 })
    expect(resolveResizePreviewGeometry(layout, otherPreview)).toEqual({ left: 100, width: 200 })
  })

  it('expands the visible segment from the right edge', () => {
    const layout = createLayout()

    expect(resolveResizePreviewGeometry(layout, createPreview(layout, 1000, 4000)))
      .toEqual({ left: 100, width: 300 })
  })

  it('moves and shrinks the visible segment from the left edge', () => {
    const layout = createLayout()

    expect(resolveResizePreviewGeometry(layout, createPreview(layout, 1500, 3000)))
      .toEqual({ left: 150, width: 150 })
  })

  it('keeps the original geometry for an invalid source duration', () => {
    const layout = createLayout()
    layout.segment.end = layout.segment.start

    expect(resolveResizePreviewGeometry(layout, createPreview(layout, 1000, 2000)))
      .toEqual({ left: 100, width: 200 })
  })
})
