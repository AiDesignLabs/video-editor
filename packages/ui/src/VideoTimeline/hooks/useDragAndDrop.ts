import type { Ref } from 'vue'
import type { SegmentDragPayload, SegmentLayout, TimelineTrack } from '../types'
import { ref } from 'vue'
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
  trackHeightPx: Ref<number>
  trackGapPx: Ref<number>
  pixelsPerMs: Ref<number>
  disableInteraction: Ref<boolean>
  snap: (time: number) => number
  onDragStart: (payload: SegmentDragPayload) => void
  onDrag: (payload: SegmentDragPayload) => void
  onDragEnd: (payload: SegmentDragPayload) => void
}

export function useDragAndDrop(options: UseDragAndDropOptions) {
  const {
    tracks,
    tracksRef,
    trackHeightPx,
    trackGapPx,
    pixelsPerMs,
    disableInteraction,
    snap,
    onDragStart,
    onDrag,
    onDragEnd,
  } = options

  const draggingState = ref<DragState | null>(null)
  const dragPreview = ref<SegmentDragPayload | null>(null)

  // 使用检测 hook
  const { detectTrackGap, resolveTrackIndexFromClientY } = useDragDetection(
    tracksRef,
    tracks,
    trackHeightPx,
    trackGapPx,
  )

  // 使用视觉反馈 hook
  const { snapGuides } = useDragVisualFeedback(
    dragPreview,
    tracks,
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
        const step = trackHeightPx.value + trackGapPx.value
        const trackTop = mouseTrackIndex * step
        const trackCenter = trackTop + trackHeightPx.value / 2

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

    const startTime = snap(layout.segment.start + deltaX / Math.max(pixelsPerMs.value, 0.0001))
    const nextStart = Math.max(0, startTime)
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
  }

  return {
    // State
    draggingState,
    dragPreview,
    snapGuides,

    // Methods
    startDrag,
    handleDragMove,
    handleDragEnd,
  }
}
