import type { IKeyframeEasing, IKeyframeTrack } from './protocol'

/**
 * Pure keyframe sampling per RFC 0002 (docs/rfcs/0002-keyframe-curves.md):
 * - timeMs is timeline time relative to segment.startTime (not source time)
 * - values hold at the first/last frame outside the keyframed range
 * - easing shapes the outgoing edge toward the next keyframe
 */

const NAMED_EASINGS: Record<string, [number, number, number, number]> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
}

export function sampleKeyframes(track: IKeyframeTrack, relMs: number): number {
  const frames = track.frames
  const first = frames[0]
  if (!first)
    return Number.NaN
  if (frames.length === 1 || relMs <= first.timeMs)
    return first.value
  const last = frames[frames.length - 1]!
  if (relMs >= last.timeMs)
    return last.value

  for (let i = 0; i < frames.length - 1; i++) {
    const from = frames[i]!
    const to = frames[i + 1]!
    if (relMs < from.timeMs || relMs > to.timeMs)
      continue
    const span = to.timeMs - from.timeMs
    if (span <= 0)
      return to.value
    const progress = (relMs - from.timeMs) / span
    return from.value + (to.value - from.value) * easeKeyframeProgress(from.easing, progress)
  }
  return last.value
}

export function easeKeyframeProgress(easing: IKeyframeEasing | undefined, progress: number): number {
  if (!easing || easing === 'linear')
    return progress
  const points = Array.isArray(easing) ? easing : NAMED_EASINGS[easing]
  if (!points)
    return progress
  return cubicBezierEase(points[0], points[1], points[2], points[3], progress)
}

/**
 * CSS-style cubic-bezier easing: solve x(t) = progress for t, return y(t).
 * Newton iterations with a bisection fallback; no dependencies.
 */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number, progress: number): number {
  if (progress <= 0)
    return 0
  if (progress >= 1)
    return 1

  const sampleX = (t: number) => bezierAxis(t, x1, x2)
  const sampleY = (t: number) => bezierAxis(t, y1, y2)
  const sampleDerivativeX = (t: number) => bezierAxisDerivative(t, x1, x2)

  let t = progress
  for (let i = 0; i < 8; i++) {
    const x = sampleX(t) - progress
    if (Math.abs(x) < 1e-6)
      return sampleY(t)
    const d = sampleDerivativeX(t)
    if (Math.abs(d) < 1e-6)
      break
    t -= x / d
  }

  let low = 0
  let high = 1
  t = progress
  while (high - low > 1e-6) {
    if (sampleX(t) < progress)
      low = t
    else
      high = t
    t = (low + high) / 2
  }
  return sampleY(t)
}

function bezierAxis(t: number, p1: number, p2: number): number {
  const inv = 1 - t
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t
}

function bezierAxisDerivative(t: number, p1: number, p2: number): number {
  const inv = 1 - t
  return 3 * inv * inv * p1 + 6 * inv * t * (p2 - p1) + 3 * t * t * (1 - p2)
}
