import type { ComputedRef, Ref } from 'vue'
import type { SegmentDragPayload, TimelineTrack } from '../types'
import { computed } from 'vue'

export interface SnapGuide {
  time: number
  left: number
}

export function useDragVisualFeedback(
  dragPreview: Ref<SegmentDragPayload | null>,
  tracks: ComputedRef<TimelineTrack[]> | Ref<TimelineTrack[]>,
  pixelsPerMs: Ref<number>,
) {
  /**
   * Calculate snap guide positions
   * Displayed when the dragged segment boundaries are close to other segment boundaries
   */
  const snapGuides = computed<SnapGuide[]>(() => {
    if (!dragPreview.value)
      return []

    const guides = new Set<number>()
    const dragStart = dragPreview.value.startTime
    const dragEnd = dragPreview.value.endTime
    const snapThreshold = 100 // 100ms threshold

    const tracksValue = 'value' in tracks ? tracks.value : tracks
    tracksValue.forEach((track) => {
      track.segments.forEach((seg) => {
        // Skip the segment being dragged
        if (seg.id === dragPreview.value?.segment.id)
          return

        // Check if drag start is close to other segment boundaries
        if (Math.abs(seg.start - dragStart) < snapThreshold) {
          guides.add(seg.start)
        }
        if (Math.abs(seg.end - dragStart) < snapThreshold) {
          guides.add(seg.end)
        }

        // Check if drag end is close to other segment boundaries
        if (Math.abs(seg.start - dragEnd) < snapThreshold) {
          guides.add(seg.start)
        }
        if (Math.abs(seg.end - dragEnd) < snapThreshold) {
          guides.add(seg.end)
        }
      })
    })

    return Array.from(guides).map(timeMs => ({
      time: timeMs,
      left: timeMs * pixelsPerMs.value,
    }))
  })

  return {
    snapGuides,
  }
}
