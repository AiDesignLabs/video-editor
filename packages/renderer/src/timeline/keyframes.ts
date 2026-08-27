import type { IKeyframe, IKeyframeEasing, IKeyframeProperty, IKeyframeTrack, ITransform, SegmentUnion } from '@video-editor/shared'

/**
 * Pure keyframe sampling per RFC 0002:
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
    return from.value + (to.value - from.value) * ease(from.easing, progress)
  }
  return last.value
}

export function findKeyframeTrack(segment: SegmentUnion, property: IKeyframeProperty): IKeyframeTrack | undefined {
  return segment.keyframes?.find(track => track.property === property && track.frames.length > 0)
}

/** Sample one property, or undefined when the segment has no track for it. */
export function sampleSegmentKeyframe(
  segment: SegmentUnion,
  property: IKeyframeProperty,
  atMs: number,
): number | undefined {
  const track = findKeyframeTrack(segment, property)
  if (!track)
    return undefined
  const value = sampleKeyframes(track, Math.max(0, atMs - segment.startTime))
  return Number.isFinite(value) ? value : undefined
}

export interface SampledVisualKeyframes {
  opacity?: number
  transform?: ITransform
}

/**
 * Sample the visual keyframe properties at `atMs`. Keyframed values replace
 * the static ones; `baseTransform` supplies the untouched axes.
 */
export function sampleVisualKeyframes(
  segment: SegmentUnion,
  atMs: number,
  baseTransform: ITransform | undefined,
): SampledVisualKeyframes {
  if (!segment.keyframes?.length)
    return {}

  const result: SampledVisualKeyframes = {}

  const opacity = sampleSegmentKeyframe(segment, 'opacity', atMs)
  if (opacity !== undefined)
    result.opacity = clamp(opacity, 0, 1)

  const positionX = sampleSegmentKeyframe(segment, 'position.x', atMs)
  const positionY = sampleSegmentKeyframe(segment, 'position.y', atMs)
  const scale = sampleSegmentKeyframe(segment, 'scale', atMs)
  const rotation = sampleSegmentKeyframe(segment, 'rotation', atMs)

  if (positionX !== undefined || positionY !== undefined || scale !== undefined || rotation !== undefined) {
    const base: ITransform = baseTransform
      ? {
          position: [...baseTransform.position],
          rotation: [...baseTransform.rotation],
          scale: [...baseTransform.scale],
        }
      : { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }

    if (positionX !== undefined)
      base.position[0] = clamp(positionX, -1, 1)
    if (positionY !== undefined)
      base.position[1] = clamp(positionY, -1, 1)
    if (scale !== undefined) {
      base.scale[0] = scale
      base.scale[1] = scale
    }
    if (rotation !== undefined)
      base.rotation[2] = rotation

    result.transform = base
  }

  return result
}

function ease(easing: IKeyframeEasing | undefined, progress: number): number {
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

/** Sample a keyframe list directly (used by compose gain scheduling). */
export function sampleFrames(frames: IKeyframe[], relMs: number): number {
  return sampleKeyframes({ property: 'volume', frames }, relMs)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
