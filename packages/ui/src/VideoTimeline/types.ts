export interface TimelineSegment {
  id: string
  start: number
  end: number
  type?: string
  color?: string
  payload?: unknown
}

export interface TimelineTrack {
  id: string
  label?: string
  type?: string
  color?: string
  isMain?: boolean
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
