import type { IKeyframe, IKeyframeProperty, IKeyframeTrack, ITransform, SegmentUnion } from '@video-editor/shared'
import { sampleKeyframes } from '@video-editor/shared'

export { cubicBezierEase, sampleKeyframes } from '@video-editor/shared'

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

/** Sample a keyframe list directly (used by compose gain scheduling). */
export function sampleFrames(frames: IKeyframe[], relMs: number): number {
  return sampleKeyframes({ property: 'volume', frames }, relMs)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
