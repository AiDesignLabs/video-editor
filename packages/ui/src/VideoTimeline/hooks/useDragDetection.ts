import type { Ref } from 'vue'
import type { TimelineTrack } from '../types'

export interface TrackGapInfo {
  isGap: boolean
  insertIndex: number
}

export function useDragDetection(
  tracksRef: Ref<HTMLElement | null>,
  tracks: Ref<TimelineTrack[]>,
  trackHeightPx: Ref<number>,
  trackGapPx: Ref<number>,
) {
  /**
   * Detect if mouse is in the gap between tracks to determine if a new track should be created
   */
  function detectTrackGap(clientY: number): TrackGapInfo | null {
    if (!tracksRef.value || !tracks.value.length)
      return null

    const rect = tracksRef.value.getBoundingClientRect()
    const relativeY = clientY - rect.top
    const step = trackHeightPx.value + trackGapPx.value
    const gapSize = trackGapPx.value

    // Check if mouse is before the first track (including negative area, i.e., above the ruler)
    if (relativeY < gapSize / 2) {
      return { isGap: true, insertIndex: 0 }
    }

    // Check gaps between tracks
    for (let i = 0; i < tracks.value.length; i++) {
      const trackEnd = (i + 1) * step - gapSize / 2
      const nextTrackStart = (i + 1) * step + gapSize / 2

      if (relativeY >= trackEnd && relativeY < nextTrackStart) {
        return { isGap: true, insertIndex: i + 1 }
      }
    }

    return null
  }

  /**
   * Resolve track index from mouse Y coordinate
   */
  function resolveTrackIndexFromClientY(clientY: number) {
    if (!tracksRef.value)
      return -1
    if (!tracks.value.length)
      return -1
    const rect = tracksRef.value.getBoundingClientRect()
    const relativeY = clientY - rect.top
    const step = trackHeightPx.value + trackGapPx.value
    if (relativeY < 0)
      return -1
    return Math.min(
      tracks.value.length - 1,
      Math.max(0, Math.floor(relativeY / step)),
    )
  }

  return {
    detectTrackGap,
    resolveTrackIndexFromClientY,
  }
}
