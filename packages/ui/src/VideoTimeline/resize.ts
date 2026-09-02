import type { SegmentLayout, SegmentResizePayload } from './types'

export interface SegmentGeometry {
  left: number
  width: number
}

export function resolveResizePreviewGeometry(
  layout: Pick<SegmentLayout, 'segment' | 'left' | 'width'>,
  preview?: Pick<SegmentResizePayload, 'segment' | 'startTime' | 'endTime'> | null,
): SegmentGeometry {
  if (!preview || preview.segment.id !== layout.segment.id)
    return { left: layout.left, width: layout.width }

  const duration = layout.segment.end - layout.segment.start
  if (duration <= 0 || !Number.isFinite(layout.width))
    return { left: layout.left, width: layout.width }

  const pixelsPerMs = layout.width / duration
  return {
    left: layout.left + (preview.startTime - layout.segment.start) * pixelsPerMs,
    width: Math.max(0, (preview.endTime - preview.startTime) * pixelsPerMs),
  }
}
