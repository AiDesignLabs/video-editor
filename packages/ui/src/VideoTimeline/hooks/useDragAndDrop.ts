import type { Ref } from 'vue'
import type { TrackMetrics } from '../metrics'
import type { SnapResolution } from '../snap'
import type { SegmentDragPayload, SegmentLayout, TimelineTrack } from '../types'
import { ref } from 'vue'
import { trackHeightAt, trackTopAt } from '../metrics'
import { useDragDetection } from './useDragDetection'
import { useDragVisualFeedback } from './useDragVisualFeedback'

interface DragState {
  layout: SegmentLayout
  initialX: number
  initialY: number
  moved: boolean
}

export interface UseDragAndDropOptions {
  tracks: Ref<TimelineTrack[]>
  tracksRef: Ref<HTMLElement | null>
  /** Vertical geometry of the rows; see VideoTimeline/metrics.ts. */
  metrics: Ref<TrackMetrics>
  pixelsPerMs: Ref<number>
  disableInteraction: Ref<boolean>
  /**
   * Resolves the snapped start time of the dragged segment. Both edges are
   * considered by the resolver; the returned guide times describe the matches
   * that were actually applied.
   */
  snap: (rawStartMs: number, durationMs: number, excludeId?: string) => SnapResolution
  onDragStart: (payload: SegmentDragPayload) => void
  onDrag: (payload: SegmentDragPayload) => void
  onDragEnd: (payload: SegmentDragPayload) => void
}

export function useDragAndDrop(options: UseDragAndDropOptions) {
  const {
    tracks,
    tracksRef,
    metrics,
    pixelsPerMs,
    disableInteraction,
    snap,
    onDragStart,
    onDrag,
    onDragEnd,
  } = options

  const draggingState = ref<DragState | null>(null)
  const dragPreview = ref<SegmentDragPayload | null>(null)
  /** Candidate times matched by the last resolved snap, drawn as guide lines. */
  const snapGuideTimes = ref<number[]>([])

  // 使用检测 hook
  const { detectTrackGap, resolveTrackIndexFromClientY } = useDragDetection(
    tracksRef,
    tracks,
    metrics,
  )

  // 使用视觉反馈 hook
  const { snapGuides } = useDragVisualFeedback(
    dragPreview,
    snapGuideTimes,
    pixelsPerMs,
  )

  /**
   * Start dragging
   */
  function startDrag(layout: SegmentLayout, event: MouseEvent) {
    if (disableInteraction.value)
      return
    draggingState.value = {
      layout,
      initialX: event.clientX,
      initialY: event.clientY,
      moved: false,
    }
    snapGuideTimes.value = []
  }

  /**
   * Emit drag preview event
   */
  function emitDragPreview(state: DragState, clientX: number, clientY: number, trigger: 'drag' | 'end') {
    const { layout, initialX, initialY } = state
    const deltaX = clientX - initialX
    const deltaY = clientY - initialY
    const movedEnough = Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5

    if (!state.moved && movedEnough) {
      state.moved = true
      const payload: SegmentDragPayload = {
        segment: layout.segment,
        track: layout.track,
        trackIndex: layout.trackIndex,
        segmentIndex: layout.segmentIndex,
        startTime: layout.segment.start,
        endTime: layout.segment.end,
        targetTrackIndex: layout.trackIndex,
        targetTrackId: layout.track.id,
        isNewTrack: false,
        visualTrackIndex: layout.trackIndex,
        isValidTarget: true,
        mouseDeltaX: 0,
        mouseDeltaY: 0,
      }
      onDragStart(payload)
    }

    const duration = layout.segment.end - layout.segment.start

    const segmentType = layout.segment.type || layout.track.type

    // Get current track index under mouse
    const rawIndex = resolveTrackIndexFromClientY(clientY)
    const mouseTrackIndex = rawIndex >= 0 ? rawIndex : layout.trackIndex
    const mouseTrack = tracks.value[mouseTrackIndex]

    let targetTrackIndex: number // Actual track index where segment will be placed
    let visualTrackIndex: number // Visual preview track index that follows mouse
    let targetTrackId: string
    let isNewTrack = false
    let newTrackInsertIndex: number | undefined
    let isValidTarget = true // Whether current position is a valid drop target

    // Type compatibility check
    const isSameType = mouseTrack && mouseTrack.type === segmentType

    if (isSameType) {
      // Same type track - check if in track or in gap
      const gap = detectTrackGap(clientY)

      if (gap) {
        // In gap - create new track
        isNewTrack = true
        newTrackInsertIndex = gap.insertIndex
        targetTrackIndex = gap.insertIndex
        visualTrackIndex = gap.insertIndex
        targetTrackId = layout.track.id
        isValidTarget = true
      }
      else {
        // In track - add to this track
        targetTrackIndex = mouseTrackIndex
        visualTrackIndex = mouseTrackIndex
        targetTrackId = mouseTrack.id
        isValidTarget = true
      }
    }
    else {
      // Different type track - determine insert position based on upper/lower half
      if (!tracksRef.value) {
        // Cannot get position info, keep at original track
        targetTrackIndex = layout.trackIndex
        visualTrackIndex = mouseTrackIndex
        targetTrackId = layout.track.id
        isValidTarget = false
      }
      else {
        const rect = tracksRef.value.getBoundingClientRect()
        const relativeY = clientY - rect.top
        const trackTop = trackTopAt(metrics.value, mouseTrackIndex)
        const trackCenter = trackTop + trackHeightAt(metrics.value, mouseTrackIndex) / 2

        // Determine if mouse is in upper or lower half of the track
        const isUpperHalf = relativeY < trackCenter

        isNewTrack = true
        newTrackInsertIndex = isUpperHalf ? mouseTrackIndex : mouseTrackIndex + 1
        targetTrackIndex = newTrackInsertIndex
        visualTrackIndex = mouseTrackIndex
        targetTrackId = layout.track.id
        isValidTarget = true
      }
    }

    const rawStart = layout.segment.start + deltaX / Math.max(pixelsPerMs.value, 0.0001)
    const resolution = snap(rawStart, duration, layout.segment.id)
    snapGuideTimes.value = resolution.guideTimes
    const nextStart = Math.max(0, resolution.time)
    const nextEnd = nextStart + duration
    const payload: SegmentDragPayload = {
      segment: layout.segment,
      track: layout.track,
      trackIndex: layout.trackIndex,
      segmentIndex: layout.segmentIndex,
      startTime: nextStart,
      endTime: nextEnd,
      targetTrackIndex,
      targetTrackId,
      isNewTrack,
      newTrackInsertIndex,
      visualTrackIndex,
      isValidTarget,
      mouseDeltaX: deltaX,
      mouseDeltaY: deltaY,
    }

    if (!state.moved)
      return

    dragPreview.value = payload

    if (trigger === 'drag')
      onDrag(payload)
    else if (trigger === 'end')
      onDragEnd(payload)
  }

  /**
   * Handle global mouse move
   */
  function handleDragMove(event: MouseEvent) {
    if (!draggingState.value)
      return
    emitDragPreview(draggingState.value, event.clientX, event.clientY, 'drag')
  }

  /**
   * Handle drag end
   */
  function handleDragEnd(event: MouseEvent) {
    if (!draggingState.value)
      return
    emitDragPreview(draggingState.value, event.clientX, event.clientY, 'end')
    draggingState.value = null
    dragPreview.value = null
    snapGuideTimes.value = []
  }

  return {
    // State
    draggingState,
    dragPreview,
    snapGuides,
    snapGuideTimes,

    // Methods
    startDrag,
    handleDragMove,
    handleDragEnd,
  }
}
