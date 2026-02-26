import type {
  ITransitionEdge,
  IVideoProtocol,
} from '@video-editor/shared'

export interface ResolvedTransitionEdge {
  id: string
  name: string
  duration: number
  fromSegmentId: string
  toSegmentId: string
}

export function collectTransitionByFromSegmentId(protocol: IVideoProtocol): Map<string, ResolvedTransitionEdge> {
  const transitionByFromSegmentId = new Map<string, ResolvedTransitionEdge>()
  const adjacentToByFrom = collectAdjacentFramePairs(protocol)

  for (const transition of protocol.transitions ?? []) {
    if (!isValidTransitionEdge(transition))
      continue
    const adjacentTo = adjacentToByFrom.get(transition.fromSegmentId)
    if (adjacentTo !== transition.toSegmentId)
      continue
    transitionByFromSegmentId.set(transition.fromSegmentId, {
      id: transition.id,
      name: transition.name,
      duration: transition.duration,
      fromSegmentId: transition.fromSegmentId,
      toSegmentId: transition.toSegmentId,
    })
  }

  return transitionByFromSegmentId
}

function isValidTransition(transition: ITransitionEdge | null | undefined): transition is ITransitionEdge {
  if (!transition || typeof transition !== 'object')
    return false
  if (typeof transition.id !== 'string' || typeof transition.name !== 'string')
    return false
  return Number.isFinite(transition.duration) && transition.duration > 0
}

function isValidTransitionEdge(edge: ITransitionEdge | null | undefined): edge is ITransitionEdge {
  if (!edge || typeof edge !== 'object')
    return false
  if (typeof edge.fromSegmentId !== 'string' || typeof edge.toSegmentId !== 'string')
    return false
  return isValidTransition(edge)
}

function collectAdjacentFramePairs(protocol: IVideoProtocol): Map<string, string> {
  const adjacentToByFrom = new Map<string, string>()
  for (const track of protocol.tracks) {
    if (track.trackType !== 'frames')
      continue
    const children = track.children
    for (let i = 0; i < children.length - 1; i++) {
      const fromSegment = children[i]
      const toSegment = children[i + 1]
      if (!fromSegment || !toSegment)
        continue
      adjacentToByFrom.set(fromSegment.id, toSegment.id)
    }
  }
  return adjacentToByFrom
}
