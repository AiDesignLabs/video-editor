import type { ITrackType } from '@video-editor/shared'

/**
 * A transform change produced by dragging the canvas gizmo.
 * Only the properties touched by the current gesture are present.
 */
export interface GizmoTransformPatch {
  segmentId: string
  segmentType: ITrackType
  /** Normalized position in [-1, 1]; already clamped. */
  position?: { x: number, y: number }
  /** Transform scale, already clamped to [0.01, 5]. */
  scale?: { x: number, y: number }
  /** Z rotation in degrees, normalized to [0, 360). */
  rotationDeg?: number
  /**
   * True when the segment animates transform properties with keyframes, so the
   * host should write a keyframe at the playhead instead of the static transform.
   */
  keyframed: boolean
}
