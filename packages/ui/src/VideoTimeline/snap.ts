import type { TimelineTrack } from './types'

/** Pixel distance under which an edge magnets to a candidate time. */
export const SNAP_THRESHOLD_PX = 8

/** Floating point tolerance used when comparing candidate deltas (ms). */
const EPSILON_MS = 1e-6

export interface SnapCandidate {
  /** Candidate time on the timeline, in milliseconds. */
  time: number
  /**
   * Whether a matched candidate should draw a guide line. Grid candidates are
   * silent: they quantize the value without cluttering the timeline.
   */
  guide: boolean
}

export interface SnapResolution {
  /** Snapped start time of the segment, in milliseconds. */
  time: number
  /** Times of the matched candidates that should be drawn as guide lines. */
  guideTimes: number[]
}

/**
 * Resolve the snapped start time of a segment by testing BOTH of its edges
 * against every candidate. The candidate/edge pair with the smallest absolute
 * delta within `thresholdMs` wins, and its delta is applied to the start.
 *
 * Guide candidates (real boundaries, playhead, origin) take priority over the
 * silent grid candidates, so a visible magnet is never stolen by quantization.
 *
 * Returns `null` when no candidate is close enough, so the caller can fall back
 * to plain grid quantization.
 */
export function resolveSnapCandidates(
  candidates: SnapCandidate[],
  rawStart: number,
  durationMs: number,
  thresholdMs: number,
): SnapResolution | null {
  if (!Number.isFinite(rawStart) || !Number.isFinite(thresholdMs) || thresholdMs <= 0)
    return null

  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  const rawEnd = rawStart + duration

  const pickBestDelta = (pool: SnapCandidate[]): number => {
    let delta = Number.NaN
    let bestAbs = Number.POSITIVE_INFINITY
    for (const candidate of pool) {
      if (!Number.isFinite(candidate.time))
        continue
      const deltas = duration > 0
        ? [candidate.time - rawStart, candidate.time - rawEnd]
        : [candidate.time - rawStart]
      for (const value of deltas) {
        const abs = Math.abs(value)
        if (abs > thresholdMs)
          continue
        if (abs < bestAbs - EPSILON_MS) {
          bestAbs = abs
          delta = value
        }
      }
    }
    return delta
  }

  let bestDelta = pickBestDelta(candidates.filter(candidate => candidate.guide))
  if (!Number.isFinite(bestDelta))
    bestDelta = pickBestDelta(candidates.filter(candidate => !candidate.guide))

  if (!Number.isFinite(bestDelta))
    return null

  const guideTimes: number[] = []
  for (const candidate of candidates) {
    if (!candidate.guide || !Number.isFinite(candidate.time))
      continue
    const matchesStart = Math.abs((candidate.time - rawStart) - bestDelta) <= EPSILON_MS
    const matchesEnd = duration > 0 && Math.abs((candidate.time - rawEnd) - bestDelta) <= EPSILON_MS
    if ((matchesStart || matchesEnd) && !guideTimes.includes(candidate.time))
      guideTimes.push(candidate.time)
  }

  return {
    time: Math.max(0, rawStart + bestDelta),
    guideTimes: guideTimes.sort((a, b) => a - b),
  }
}

/** Quantize a time to the nearest multiple of `step` (never negative). */
export function quantizeToGrid(time: number, step: number): number {
  if (!Number.isFinite(time))
    return 0
  if (!Number.isFinite(step) || step <= 0)
    return Math.max(time, 0)
  return Math.max(Math.round(time / step) * step, 0)
}

export interface CollectSnapCandidatesInput {
  tracks: TimelineTrack[]
  /** Start time being dragged/resized, in milliseconds. */
  rawStart: number
  /** Duration of the segment, in milliseconds (0 for a single edge). */
  durationMs: number
  /** Grid step in milliseconds (frame duration or an explicit snap step). */
  gridStepMs: number
  /** Playhead position, in milliseconds. */
  playheadMs?: number
  /** Segment id to ignore (the one being manipulated). */
  excludeId?: string
}

/**
 * Build the candidate set: the nearest grid multiple of each edge (silent),
 * every other segment's start/end, the playhead and the timeline origin.
 */
export function collectSnapCandidates(input: CollectSnapCandidatesInput): SnapCandidate[] {
  const { tracks, rawStart, durationMs, gridStepMs, playheadMs, excludeId } = input
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  const candidates: SnapCandidate[] = []

  if (Number.isFinite(gridStepMs) && gridStepMs > 0) {
    candidates.push({ time: quantizeToGrid(rawStart, gridStepMs), guide: false })
    if (duration > 0)
      candidates.push({ time: quantizeToGrid(rawStart + duration, gridStepMs), guide: false })
  }

  candidates.push({ time: 0, guide: true })
  if (typeof playheadMs === 'number' && Number.isFinite(playheadMs))
    candidates.push({ time: Math.max(0, playheadMs), guide: true })

  for (const track of tracks) {
    for (const segment of track.segments) {
      if (excludeId && segment.id === excludeId)
        continue
      candidates.push({ time: segment.start, guide: true })
      candidates.push({ time: segment.end, guide: true })
    }
  }

  return candidates
}
