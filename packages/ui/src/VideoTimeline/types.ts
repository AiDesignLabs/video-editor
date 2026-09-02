export interface TimelineSegment {
  id: string
  start: number
  end: number
  type?: string
  color?: string
  fromTime?: number
  sourceDurationMs?: number
  payload?: unknown
}

export interface TimelineTrack {
  id: string
  label?: string
  type?: string
  color?: string
  isMain?: boolean
  /** Presentation flag: the track's visuals are skipped by the renderer. */
  hidden?: boolean
  /** Presentation flag: the track's audio is skipped by the renderer. */
  muted?: boolean
  payload?: unknown
  segments: TimelineSegment[]
}

export interface TimelineTick {
  position: number
  timeMs: number
  isMajor: boolean
  label?: string
}

export interface TickLevel {
  mainMs: number
  minorMs: number
  mode: 'time' | 'frame'
  label: 'time' | 'frame'
}

export interface SegmentLayout {
  segment: TimelineSegment
  track: TimelineTrack
  trackIndex: number
  segmentIndex: number
  left: number
  width: number
  isSelected: boolean
}

/** One rendered track row, as handed to the `overlay` slot. */
export interface TrackLayout {
  track: TimelineTrack
  trackIndex: number
  segments: SegmentLayout[]
}

/** Slot props of VideoTimeline's `overlay` slot (content-box coordinates). */
export interface TimelineOverlaySlotProps {
  trackLayouts: TrackLayout[]
  /** Buffered visible range in timeline content coordinates. */
  visibleStartPx: number
  visibleEndPx: number
  pixelsPerMs: number
  rulerHeight: number
  trackHeight: number
  /** Resolved height of each row, in source order. */
  trackHeights: number[]
  /** Top edge of each row relative to the track area (ruler height not included). */
  trackTops: number[]
  trackGap: number
}

export interface SegmentDragPayload {
  segment: TimelineSegment
  track: TimelineTrack
  trackIndex: number
  segmentIndex: number
  startTime: number
  endTime: number
  targetTrackIndex: number
  targetTrackId: string
  isNewTrack: boolean
  newTrackInsertIndex?: number
  visualTrackIndex: number // Visual preview track index that follows mouse
  isValidTarget: boolean // Whether the current mouse position is a valid drop target
  mouseDeltaX: number // Raw mouse X-axis offset in pixels
  mouseDeltaY: number // Raw mouse Y-axis offset in pixels
}

export interface SegmentResizePayload {
  segment: TimelineSegment
  track: TimelineTrack
  trackIndex: number
  segmentIndex: number
  startTime: number
  endTime: number
  edge: 'start' | 'end'
}
