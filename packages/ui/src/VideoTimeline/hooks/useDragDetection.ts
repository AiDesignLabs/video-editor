import type { Ref } from 'vue'
import type { TrackMetrics } from '../metrics'
import type { TimelineTrack } from '../types'
import { trackGapIndexAtY, trackIndexAtY } from '../metrics'

export interface TrackGapInfo {
  isGap: boolean
  insertIndex: number
}

export function useDragDetection(
  tracksRef: Ref<HTMLElement | null>,
  tracks: Ref<TimelineTrack[]>,
  metrics: Ref<TrackMetrics>,
) {
  function relativeY(clientY: number) {
    const el = tracksRef.value
    if (!el)
      return null
    return clientY - el.getBoundingClientRect().top
  }

  /**
   * Detect whether the pointer sits in the gap between two tracks, which is
   * what promotes a drop into "create a new track" rather than "move here".
   */
  function detectTrackGap(clientY: number): TrackGapInfo | null {
    if (!tracks.value.length)
      return null
    const y = relativeY(clientY)
    if (y === null)
      return null

    const insertIndex = trackGapIndexAtY(metrics.value, y)
    return insertIndex === null ? null : { isGap: true, insertIndex }
  }

  /** Resolve track index from a pointer Y coordinate. */
  function resolveTrackIndexFromClientY(clientY: number) {
    if (!tracks.value.length)
      return -1
    const y = relativeY(clientY)
    if (y === null)
      return -1
    return trackIndexAtY(metrics.value, y)
  }

  return {
    detectTrackGap,
    resolveTrackIndexFromClientY,
  }
}
