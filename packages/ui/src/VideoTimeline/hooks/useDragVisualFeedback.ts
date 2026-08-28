import type { Ref } from 'vue'
import type { SegmentDragPayload } from '../types'
import { computed } from 'vue'

export interface SnapGuide {
  time: number
  left: number
}

/**
 * Projects the snap candidates actually matched by the resolver onto pixel
 * positions, so the guide lines always describe the applied snap instead of
 * merely "nearby" boundaries.
 */
export function useDragVisualFeedback(
  dragPreview: Ref<SegmentDragPayload | null>,
  guideTimes: Ref<number[]>,
  pixelsPerMs: Ref<number>,
) {
  const snapGuides = computed<SnapGuide[]>(() => {
    if (!dragPreview.value)
      return []
    return guideTimes.value.map(timeMs => ({
      time: timeMs,
      left: timeMs * pixelsPerMs.value,
    }))
  })

  return {
    snapGuides,
  }
}
