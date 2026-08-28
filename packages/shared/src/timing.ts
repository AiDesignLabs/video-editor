/**
 * Shared source-time mapping helpers.
 *
 * A media segment occupies a timeline window `[startTime, endTime]` and reads a
 * source window `[fromTime, fromTime + sourceSpanMs]`. Every consumer (preview
 * evaluator, transition planner, audio manager, compose pipeline) must agree on
 * this mapping, otherwise preview and export drift apart.
 */

/** Lower bound for a normalized play rate. */
const MIN_PLAY_RATE = 0.1
/** Upper bound for a normalized play rate. */
const MAX_PLAY_RATE = 100

/**
 * Clamp a play rate into the supported range.
 * Non-finite or missing values fall back to 1.
 */
export function normalizePlayRate(playRate?: number): number {
  if (typeof playRate !== 'number' || !Number.isFinite(playRate))
    return 1
  return Math.max(MIN_PLAY_RATE, Math.min(MAX_PLAY_RATE, playRate))
}

/** Minimal shape needed to map a timeline time onto a source time. */
export interface SourceTimedSegment {
  startTime: number
  endTime: number
  /** Source window start in ms. Defaults to 0. */
  fromTime?: number
  /** Playback speed multiplier. Defaults to 1. */
  playRate?: number
  /** Play the same source window backwards. Defaults to false. */
  reversed?: boolean
}

function normalizeTimeMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return 0
  return Math.max(0, value)
}

/**
 * Length of the source window consumed by the segment, in ms.
 * `(endTime - startTime) * playRate`.
 */
export function sourceSpanMs(segment: SourceTimedSegment): number {
  const durationMs = Math.max(0, normalizeTimeMs(segment.endTime) - normalizeTimeMs(segment.startTime))
  return durationMs * normalizePlayRate(segment.playRate)
}

/**
 * Map an absolute timeline time (ms) onto the source media time (ms).
 *
 * Forward:  `fromTime + relMs * rate`
 * Reversed: `fromTime + (span - relMs * rate)` — the same source window
 * `[fromTime, fromTime + span]` read from its end back to its start.
 */
export function mapSourceTimeMs(segment: SourceTimedSegment, timelineMs: number): number {
  const relativeMs = Math.max(0, normalizeTimeMs(timelineMs) - normalizeTimeMs(segment.startTime))
  const fromTime = normalizeTimeMs(segment.fromTime)
  const playRate = normalizePlayRate(segment.playRate)
  if (segment.reversed === true) {
    const span = sourceSpanMs(segment)
    return Math.max(fromTime, fromTime + Math.max(0, span - relativeMs * playRate))
  }
  return Math.max(0, fromTime + relativeMs * playRate)
}
