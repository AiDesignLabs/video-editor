import type { ITrackType } from '@video-editor/shared'

/** Position component of `ITransform`, normalized to [-1, 1]. */
export const GIZMO_POSITION_MIN = -1
export const GIZMO_POSITION_MAX = 1
/** Scale component of `ITransform`. */
export const GIZMO_SCALE_MIN = 0.01
export const GIZMO_SCALE_MAX = 5

/**
 * On-stage bounding box of a rendered visual segment, in logical stage pixels.
 * Produced by the renderer after each `renderScene` pass.
 */
export interface VisualBox {
  segmentId: string
  segmentType: ITrackType
  /** Paint order of the segment within the frame; higher sits on top. */
  zOrder: number
  centerX: number
  centerY: number
  /** Final on-stage size, i.e. after the transform scale is applied. */
  width: number
  height: number
  rotationRad: number
  /** Fill-mode resolved size BEFORE the transform scale is applied. */
  baseWidth: number
  baseHeight: number
  /** True when the segment animates any transform property with keyframes. */
  hasTransformKeyframes: boolean
}

/** Minimal geometry needed to draw or hit-test a gizmo box. */
export interface GizmoBox {
  centerX: number
  centerY: number
  width: number
  height: number
  rotationRad: number
  baseWidth: number
  baseHeight: number
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value))
    return min
  return Math.min(Math.max(value, min), max)
}

/** Rotate a stage point into the local (unrotated) space of a box. */
export function toBoxLocalPoint(box: GizmoBox, x: number, y: number) {
  const dx = x - box.centerX
  const dy = y - box.centerY
  const cos = Math.cos(-box.rotationRad)
  const sin = Math.sin(-box.rotationRad)
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}

export function isPointInBox(box: GizmoBox, x: number, y: number) {
  const local = toBoxLocalPoint(box, x, y)
  return Math.abs(local.x) <= Math.abs(box.width) / 2
    && Math.abs(local.y) <= Math.abs(box.height) / 2
}

/**
 * Find the top-most box containing the given stage point.
 * Boxes with a higher `zOrder` win; ties fall back to the later entry.
 */
export function hitTestBoxes(boxes: VisualBox[], x: number, y: number): VisualBox | undefined {
  let hit: VisualBox | undefined
  for (const box of boxes) {
    if (!isPointInBox(box, x, y))
      continue
    if (!hit || box.zOrder >= hit.zOrder)
      hit = box
  }
  return hit
}

/** Inverse of the forward layout math: stage center -> normalized position. */
export function positionFromCenter(centerX: number, centerY: number, stageW: number, stageH: number) {
  const safeW = stageW || 1
  const safeH = stageH || 1
  return {
    px: clamp((2 * centerX) / safeW - 1, GIZMO_POSITION_MIN, GIZMO_POSITION_MAX),
    py: clamp(1 - (2 * centerY) / safeH, GIZMO_POSITION_MIN, GIZMO_POSITION_MAX),
  }
}

/** Inverse of the forward layout math: final size -> transform scale. */
export function scaleFromSize(finalW: number, finalH: number, baseW: number, baseH: number) {
  const safeBaseW = baseW || 1
  const safeBaseH = baseH || 1
  return {
    sx: clamp(finalW / safeBaseW, GIZMO_SCALE_MIN, GIZMO_SCALE_MAX),
    sy: clamp(finalH / safeBaseH, GIZMO_SCALE_MIN, GIZMO_SCALE_MAX),
  }
}

/** Convert radians to a degree value normalized into [0, 360). */
export function normalizeRotationDeg(rad: number) {
  if (!Number.isFinite(rad))
    return 0
  const deg = (rad * 180) / Math.PI
  return ((deg % 360) + 360) % 360
}

/** Snap a degree value to the nearest multiple of `step`, normalized into [0, 360). */
export function snapRotationDeg(deg: number, step: number) {
  if (step <= 0)
    return ((deg % 360) + 360) % 360
  const snapped = Math.round(deg / step) * step
  return ((snapped % 360) + 360) % 360
}
