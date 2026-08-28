import type { ITransitionEdge } from '@video-editor/shared'

/** Emitted when the user clicks a transition seam on the main frames track. */
export interface TransitionEditPayload {
  fromSegmentId: string
  toSegmentId: string
  /** Timeline time (ms) of the boundary between the two segments. */
  boundaryTime: number
  /** The transition already configured on this boundary, when there is one. */
  existing?: ITransitionEdge
}

/** One rendered seam chip, positioned in the timeline content coordinate box. */
export interface TransitionSeam extends TransitionEditPayload {
  key: string
  left: number
  top: number
}
