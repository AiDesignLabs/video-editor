import type { ITransform, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { TransitionRole } from './transition-registry'
import type { VisualEffectParam, VisualPlanItem } from './types'
import { isVideoFramesSegment } from '@video-editor/shared'
import { getTransitionDefinition } from './transition-registry'

/** Transition state attached to a render item, consumed by the filter cache. */
export interface VisualRenderTransition {
  role: TransitionRole
  progress: number
  durationMs: number
  transitionId?: string
  transitionName?: string
}

export interface VisualRenderItem {
  segment: SegmentUnion
  sourceTimeMs: number
  opacity: number
  transform?: ITransform
  includeAudio: boolean
  effects?: VisualEffectParam[]
  transition?: VisualRenderTransition
}

export function createVisualRenderItems(
  protocol: IVideoProtocol,
  visuals: VisualPlanItem[],
): VisualRenderItem[] {
  const segmentById = indexSegments(protocol)
  const activeSegmentIds = new Set<string>()
  for (const visual of visuals)
    activeSegmentIds.add(visual.segmentId)

  const items: VisualRenderItem[] = []
  for (const visual of visuals) {
    const segment = segmentById.get(visual.segmentId)
    if (!segment)
      continue

    const progress = clamp01(visual.transition?.progress ?? 0)
    // A registered shader transition drives the blend itself, so the plan must
    // emit both sides at their intrinsic opacity. Unresolved transitions keep
    // the legacy opacity crossfade.
    const shaderDriven = visual.transition ? Boolean(resolveTransitionDefinition(visual.transition)) : false
    const fromOpacity = clamp01(visual.opacity) * (visual.transition && !shaderDriven ? (1 - progress) : 1)
    const transitionDurationMs = normalizeTimeMs(visual.transition?.durationMs)

    items.push({
      segment,
      sourceTimeMs: Math.max(0, visual.sourceTimeMs),
      opacity: fromOpacity,
      transform: visual.transform,
      includeAudio: true,
      effects: visual.effects,
      transition: visual.transition
        ? {
            role: 'from',
            progress,
            durationMs: transitionDurationMs,
            transitionId: visual.transition.transitionId,
            transitionName: visual.transition.transitionName,
          }
        : undefined,
    })

    if (!visual.transition || progress <= 0)
      continue
    if (activeSegmentIds.has(visual.transition.toSegmentId))
      continue

    const targetSegment = segmentById.get(visual.transition.toSegmentId)
    if (!targetSegment)
      continue

    if (transitionDurationMs <= 0)
      continue
    const elapsedTransitionMs = transitionDurationMs * progress
    const targetSourceTimeMs = mapTransitionTargetSourceTimeMs(targetSegment, elapsedTransitionMs)
    const targetOpacity = readSegmentOpacity(targetSegment) * (shaderDriven ? 1 : progress)

    items.push({
      segment: targetSegment,
      sourceTimeMs: targetSourceTimeMs,
      opacity: targetOpacity,
      transform: 'transform' in targetSegment ? targetSegment.transform : undefined,
      includeAudio: false,
      effects: visual.effects,
      transition: {
        role: 'to',
        progress,
        durationMs: transitionDurationMs,
        transitionId: visual.transition.transitionId,
        transitionName: visual.transition.transitionName,
      },
    })
  }

  return items
}

/** Resolve by protocol transition id, then by (case-insensitive) name. */
function resolveTransitionDefinition(transition: NonNullable<VisualPlanItem['transition']>) {
  return getTransitionDefinition(transition.transitionId)
    ?? getTransitionDefinition(transition.transitionName)
}

function indexSegments(protocol: IVideoProtocol): Map<string, SegmentUnion> {
  const segmentById = new Map<string, SegmentUnion>()
  for (const track of protocol.tracks) {
    for (const segment of track.children)
      segmentById.set(segment.id, segment)
  }
  return segmentById
}

function mapTransitionTargetSourceTimeMs(segment: SegmentUnion, elapsedTransitionMs: number): number {
  if (isVideoFramesSegment(segment)) {
    const fromTime = normalizeTimeMs(segment.fromTime)
    const playRate = normalizePlayRate(segment.playRate)
    return Math.max(0, fromTime + elapsedTransitionMs * playRate)
  }
  return Math.max(0, elapsedTransitionMs)
}

function readSegmentOpacity(segment: SegmentUnion): number {
  if ('opacity' in segment && typeof segment.opacity === 'number' && Number.isFinite(segment.opacity))
    return clamp01(segment.opacity)
  return 1
}

function normalizeTimeMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return 0
  return Math.max(0, value)
}

function normalizePlayRate(playRate: number | undefined): number {
  if (typeof playRate !== 'number' || !Number.isFinite(playRate))
    return 1
  return Math.min(Math.max(playRate, 0.1), 100)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value))
    return 0
  return Math.min(Math.max(value, 0), 1)
}
