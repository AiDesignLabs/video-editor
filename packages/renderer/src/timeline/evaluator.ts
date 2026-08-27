import type {
  IAudioSegment,
  IVideoProtocol,
  SegmentUnion,
  TrackUnion,
} from '@video-editor/shared'
import type { ResolvedTransitionEdge } from './transition-resolver'
import type {
  ActiveVoiceRef,
  AudioPlanEvent,
  EvalContext,
  EvaluatorOutput,
  EvaluatorState,
  VisualEffectParam,
  VisualPlanItem,
} from './types'
import { isAudioSegment, isVideoFramesSegment } from '@video-editor/shared'
import { collectTransitionByFromSegmentId } from './transition-resolver'

interface ActiveVoiceMeta extends ActiveVoiceRef {
  sourceTimeMs: number
  gain: number
  rate: number
}

export function createEmptyEvaluatorState(): EvaluatorState {
  return {
    activeVoices: [],
  }
}

export function evaluateTimelinePlan(
  protocol: IVideoProtocol,
  context: EvalContext,
  previousState: EvaluatorState = createEmptyEvaluatorState(),
): EvaluatorOutput {
  const atMs = normalizeTimeMs(context.atMs)
  const windowStartMs = normalizeTimeMs(context.windowStartMs)
  const windowEndMs = Math.max(windowStartMs, normalizeTimeMs(context.windowEndMs))

  const visuals: VisualPlanItem[] = []
  const activeVoiceById = new Map<string, ActiveVoiceMeta>()
  const activeEffects = collectActiveEffects(protocol, atMs)
  const transitionByFromSegmentId = collectTransitionByFromSegmentId(protocol)

  for (let trackIndex = 0; trackIndex < protocol.tracks.length; trackIndex++) {
    const track = protocol.tracks[trackIndex]!
    const trackOrder = getTrackOrder(protocol.tracks.length, trackIndex, track)

    for (let childIndex = 0; childIndex < track.children.length; childIndex++) {
      const segment = track.children[childIndex]!
      if (!isActiveAt(segment, atMs))
        continue

      if (segment.segmentType === 'effect' || segment.segmentType === 'filter')
        continue

      if (segment.segmentType !== 'audio') {
        visuals.push(buildVisualPlanItem({
          segment,
          track,
          trackOrder,
          childIndex,
          atMs,
          transition: transitionByFromSegmentId.get(segment.id),
          effects: activeEffects,
        }))
      }

      const voice = toActiveVoiceMeta(segment, track, atMs)
      if (voice)
        activeVoiceById.set(voice.voiceId, voice)
    }
  }

  visuals.sort((a, b) => {
    if (a.zOrder !== b.zOrder)
      return a.zOrder - b.zOrder
    return a.segmentId.localeCompare(b.segmentId)
  })

  const previousVoiceById = new Map<string, ActiveVoiceRef>()
  for (const previousVoice of previousState.activeVoices)
    previousVoiceById.set(previousVoice.voiceId, previousVoice)

  const audioEvents: AudioPlanEvent[] = []
  for (const [voiceId, previousVoice] of previousVoiceById) {
    if (activeVoiceById.has(voiceId))
      continue
    audioEvents.push({
      voiceId,
      segmentId: previousVoice.segmentId,
      trackId: previousVoice.trackId,
      segmentKind: previousVoice.segmentKind,
      action: 'stop',
      atTimelineMs: atMs,
    })
  }

  const activeVoices: ActiveVoiceRef[] = []
  for (const voice of activeVoiceById.values()) {
    activeVoices.push({
      voiceId: voice.voiceId,
      segmentId: voice.segmentId,
      trackId: voice.trackId,
      segmentKind: voice.segmentKind,
    })
    if (!previousVoiceById.has(voice.voiceId)) {
      audioEvents.push({
        voiceId: voice.voiceId,
        segmentId: voice.segmentId,
        trackId: voice.trackId,
        segmentKind: voice.segmentKind,
        action: 'start',
        atTimelineMs: atMs,
        sourceTimeMs: voice.sourceTimeMs,
        gain: voice.gain,
        rate: voice.rate,
      })
    }
    else if (context.discontinuity) {
      audioEvents.push({
        voiceId: voice.voiceId,
        segmentId: voice.segmentId,
        trackId: voice.trackId,
        segmentKind: voice.segmentKind,
        action: 'seek',
        atTimelineMs: atMs,
        sourceTimeMs: voice.sourceTimeMs,
      })
    }
    audioEvents.push({
      voiceId: voice.voiceId,
      segmentId: voice.segmentId,
      trackId: voice.trackId,
      segmentKind: voice.segmentKind,
      action: 'gain',
      atTimelineMs: atMs,
      gain: voice.gain,
    })
    audioEvents.push({
      voiceId: voice.voiceId,
      segmentId: voice.segmentId,
      trackId: voice.trackId,
      segmentKind: voice.segmentKind,
      action: 'rate',
      atTimelineMs: atMs,
      rate: voice.rate,
    })
  }

  return {
    plan: {
      atMs,
      windowStartMs,
      windowEndMs,
      visuals,
      audioEvents,
    },
    state: {
      activeVoices,
    },
  }
}

function buildVisualPlanItem(input: {
  segment: SegmentUnion
  track: TrackUnion
  trackOrder: number
  childIndex: number
  atMs: number
  transition: ResolvedTransitionEdge | undefined
  effects: VisualEffectParam[]
}): VisualPlanItem {
  const {
    segment,
    track,
    trackOrder,
    childIndex,
    atMs,
    transition,
    effects,
  } = input
  return {
    segmentId: segment.id,
    trackId: track.trackId,
    trackType: track.trackType,
    segmentType: segment.segmentType,
    zOrder: trackOrder * 10000 + childIndex,
    sourceTimeMs: mapSourceTimeMs(segment, atMs),
    opacity: readOpacity(segment),
    transition: computeTransition(segment, transition, atMs),
    effects: effects.length ? effects : undefined,
  }
}

function toActiveVoiceMeta(segment: SegmentUnion, track: TrackUnion, atMs: number): ActiveVoiceMeta | undefined {
  if (isAudioSegment(segment)) {
    const relativeMs = Math.max(0, atMs - segment.startTime)
    return {
      voiceId: `audio:${segment.id}`,
      segmentId: segment.id,
      trackId: track.trackId,
      segmentKind: 'audio',
      sourceTimeMs: mapRemappableSourceTimeMs(segment, atMs),
      gain: computeAudioSegmentGain(segment, relativeMs),
      rate: normalizePlayRate(segment.playRate),
    }
  }

  if (isVideoFramesSegment(segment)) {
    const gain = normalizeVolume(segment.volume)
    if (gain <= 0)
      return undefined
    return {
      voiceId: `video:${segment.id}`,
      segmentId: segment.id,
      trackId: track.trackId,
      segmentKind: 'video',
      sourceTimeMs: mapRemappableSourceTimeMs(segment, atMs),
      gain,
      rate: normalizePlayRate(segment.playRate),
    }
  }

  return undefined
}

function mapSourceTimeMs(segment: SegmentUnion, atMs: number): number {
  if (isAudioSegment(segment) || isVideoFramesSegment(segment))
    return mapRemappableSourceTimeMs(segment, atMs)
  return Math.max(0, atMs - segment.startTime)
}

function mapRemappableSourceTimeMs(
  segment: { startTime: number, fromTime?: number, playRate?: number },
  atMs: number,
): number {
  const relativeMs = Math.max(0, atMs - segment.startTime)
  const fromTime = normalizeTimeMs(segment.fromTime ?? 0)
  const playRate = normalizePlayRate(segment.playRate)
  return Math.max(0, fromTime + relativeMs * playRate)
}

function computeTransition(
  segment: SegmentUnion,
  transition: ResolvedTransitionEdge | undefined,
  atMs: number,
): VisualPlanItem['transition'] {
  if (segment.segmentType !== 'frames')
    return undefined
  if (!transition)
    return undefined
  if (transition.fromSegmentId !== segment.id)
    return undefined
  const startMs = segment.endTime - transition.duration
  if (atMs < startMs || atMs >= segment.endTime)
    return undefined
  const progress = (atMs - startMs) / transition.duration
  return {
    fromSegmentId: segment.id,
    toSegmentId: transition.toSegmentId,
    progress: clamp(progress, 0, 1),
    transitionId: transition.id,
    transitionName: transition.name,
    durationMs: transition.duration,
  }
}

function isActiveAt(segment: SegmentUnion, atMs: number): boolean {
  return segment.startTime <= atMs && atMs < segment.endTime
}

function readOpacity(segment: SegmentUnion): number {
  if ('opacity' in segment && typeof segment.opacity === 'number' && Number.isFinite(segment.opacity))
    return clamp(segment.opacity, 0, 1)
  return 1
}

function computeAudioSegmentGain(segment: IAudioSegment, relativeMs: number): number {
  const baseVolume = normalizeVolume(segment.volume)
  const segmentDurationMs = Math.max(0, segment.endTime - segment.startTime)
  const fadeInDurationMs = Math.max(0, segment.fadeInDuration ?? 0)
  const fadeOutDurationMs = Math.max(0, segment.fadeOutDuration ?? 0)

  let envelope = 1
  if (fadeInDurationMs > 0 && relativeMs < fadeInDurationMs)
    envelope = Math.max(0, relativeMs / fadeInDurationMs)

  const timeUntilEnd = segmentDurationMs - relativeMs
  if (fadeOutDurationMs > 0 && timeUntilEnd < fadeOutDurationMs)
    envelope = Math.min(envelope, Math.max(0, timeUntilEnd / fadeOutDurationMs))

  return baseVolume * envelope
}

function getTrackOrder(trackCount: number, trackIndex: number, track: TrackUnion): number {
  if (track.trackType === 'frames' && 'isMain' in track && Boolean(track.isMain))
    return 0
  return trackCount - trackIndex
}

function collectActiveEffects(protocol: IVideoProtocol, atMs: number): VisualEffectParam[] {
  const effects: VisualEffectParam[] = []
  for (const track of protocol.tracks) {
    for (const segment of track.children) {
      if (!isActiveAt(segment, atMs))
        continue
      if (segment.segmentType === 'effect') {
        effects.push({
          segmentType: 'effect',
          segmentId: segment.id,
          effectId: segment.effectId,
          name: segment.name,
        })
      }
      else if (segment.segmentType === 'filter') {
        effects.push({
          segmentType: 'filter',
          segmentId: segment.id,
          filterId: segment.filterId,
          name: segment.name,
          intensity: normalizeVolume(segment.intensity),
        })
      }
    }
  }
  return effects
}

function normalizeTimeMs(value: number): number {
  if (!Number.isFinite(value))
    return 0
  return Math.max(0, value)
}

function normalizeVolume(volume: number | undefined): number {
  if (typeof volume !== 'number' || !Number.isFinite(volume))
    return 1
  return clamp(volume, 0, 1)
}

function normalizePlayRate(playRate: number | undefined): number {
  if (typeof playRate !== 'number' || !Number.isFinite(playRate))
    return 1
  return clamp(playRate, 0.1, 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
