import type {
  IAudioSegment,
  IEffectSegment,
  IFilterSegment,
  IFramesSegmentUnion,
  IImageSegment,
  ITextSegment,
  ITrackType,
  IVideoFramesSegment,
  SegmentUnion,
} from './protocol'

/**
 * Protocol version constant
 */
export const CURRENT_PROTOCOL_VERSION = '1.0.0' as const

/**
 * Type guard: check if segment is frames segment
 */
export function isFramesSegment(segment: SegmentUnion): segment is IFramesSegmentUnion {
  return segment.segmentType === 'frames'
}

/**
 * Type guard: check if segment is video frames segment
 */
export function isVideoFramesSegment(segment: SegmentUnion): segment is IVideoFramesSegment {
  return segment.segmentType === 'frames' && 'type' in segment && segment.type === 'video'
}

/**
 * Type guard: check if segment is text segment
 */
export function isTextSegment(segment: SegmentUnion): segment is ITextSegment {
  return segment.segmentType === 'text'
}

/**
 * Type guard: check if segment is image segment
 */
export function isImageSegment(segment: SegmentUnion): segment is IImageSegment {
  return segment.segmentType === 'image'
}

/**
 * Type guard: check if segment is audio segment
 */
export function isAudioSegment(segment: SegmentUnion): segment is IAudioSegment {
  return segment.segmentType === 'audio'
}

/**
 * Type guard: check if segment is effect segment
 */
export function isEffectSegment(segment: SegmentUnion): segment is IEffectSegment {
  return segment.segmentType === 'effect'
}

/**
 * Type guard: check if segment is filter segment
 */
export function isFilterSegment(segment: SegmentUnion): segment is IFilterSegment {
  return segment.segmentType === 'filter'
}

/**
 * Get segment duration in milliseconds
 */
export function getSegmentDuration(segment: SegmentUnion): number {
  return segment.endTime - segment.startTime
}

/**
 * Check if a time point is within a segment's time range
 */
export function isTimeInSegment(time: number, segment: SegmentUnion): boolean {
  return time >= segment.startTime && time < segment.endTime
}

/**
 * Track type constants
 */
export const TRACK_TYPES: readonly ITrackType[] = ['frames', 'text', 'image', 'audio', 'effect', 'filter'] as const

/**
 * Check if a string is a valid track type
 */
export function isValidTrackType(type: string): type is ITrackType {
  return TRACK_TYPES.includes(type as ITrackType)
}
