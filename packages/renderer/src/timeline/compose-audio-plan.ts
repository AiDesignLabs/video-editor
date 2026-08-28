import type { IAudioSegment, IKeyframe, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import type { AudioPlanEvent } from './types'
import { createComposeRunner } from './compose-runner'

export interface ComposeAudioInput {
  segmentId: string
  segmentKind: 'audio' | 'video'
  url: string
  startTime: number
  endTime: number
  fromTime?: number
  playRate?: number
  volume?: number
  fadeInDuration?: number
  fadeOutDuration?: number
  /** Keyframed volume curve (timeMs relative to segment.startTime), replaces `volume` when present. */
  volumeKeyframes?: IKeyframe[]
  /** Original segment start, needed to rebase the curve onto the voice window. */
  segmentStartTime?: number
}

interface SegmentLookup {
  audioById: Map<string, IAudioSegment>
  videoById: Map<string, IVideoFramesSegment>
}

interface ActiveVoiceRuntime {
  voiceId: string
  segmentKind: 'audio' | 'video'
  segmentId: string
  startTime: number
  fromTime: number
  playRate: number
}

export function createComposeAudioInputs(protocol: IVideoProtocol): ComposeAudioInput[] {
  const lookup = createSegmentLookup(protocol)
  const boundaries = collectEvaluationBoundaries(lookup)
  if (!boundaries.length)
    return []

  const outputs: ComposeAudioInput[] = []
  const activeVoices = new Map<string, ActiveVoiceRuntime>()
  const runner = createComposeRunner()
  const plans = runner.evaluateSequence(protocol, boundaries)
  for (const plan of plans) {
    for (const event of plan.audioEvents)
      applyAudioEvent(event, lookup, activeVoices, outputs)
  }

  for (const runtime of activeVoices.values()) {
    const finalized = finalizeVoice(runtime, lookup, lookupSegmentEnd(runtime, lookup))
    if (finalized)
      outputs.push(finalized)
  }

  return outputs.sort((a, b) => {
    if (a.startTime !== b.startTime)
      return a.startTime - b.startTime
    if (a.endTime !== b.endTime)
      return a.endTime - b.endTime
    return a.segmentId.localeCompare(b.segmentId)
  })
}

function applyAudioEvent(
  event: AudioPlanEvent,
  lookup: SegmentLookup,
  activeVoices: Map<string, ActiveVoiceRuntime>,
  outputs: ComposeAudioInput[],
) {
  if (event.action === 'start') {
    const segment = lookupSegment(event.segmentKind, event.segmentId, lookup)
    if (!segment)
      return
    const volume = readSegmentVolume(segment)
    if (volume <= 0)
      return

    const runtime: ActiveVoiceRuntime = {
      voiceId: event.voiceId,
      segmentKind: event.segmentKind,
      segmentId: event.segmentId,
      startTime: event.atTimelineMs,
      fromTime: Math.max(0, event.sourceTimeMs ?? readSegmentFromTime(segment)),
      playRate: normalizePlayRate(event.rate ?? readSegmentPlayRate(segment)),
    }
    activeVoices.set(event.voiceId, runtime)
    return
  }

  if (event.action !== 'stop')
    return

  const runtime = activeVoices.get(event.voiceId)
  if (!runtime)
    return
  activeVoices.delete(event.voiceId)

  const finalized = finalizeVoice(runtime, lookup, event.atTimelineMs)
  if (finalized)
    outputs.push(finalized)
}

function finalizeVoice(
  runtime: ActiveVoiceRuntime,
  lookup: SegmentLookup,
  stopTime: number,
): ComposeAudioInput | undefined {
  const segment = lookupSegment(runtime.segmentKind, runtime.segmentId, lookup)
  if (!segment)
    return undefined

  const startTime = clamp(runtime.startTime, segment.startTime, segment.endTime)
  const endTime = clamp(stopTime, startTime, segment.endTime)
  if (endTime <= startTime)
    return undefined

  const volumeTrack = segment.keyframes?.find(track => track.property === 'volume' && track.frames.length > 0)
  const base: ComposeAudioInput = {
    segmentId: segment.id,
    segmentKind: runtime.segmentKind,
    url: segment.url,
    startTime,
    endTime,
    fromTime: runtime.fromTime,
    playRate: runtime.playRate,
    volume: readSegmentVolume(segment),
    volumeKeyframes: volumeTrack ? [...volumeTrack.frames] : undefined,
    segmentStartTime: segment.startTime,
  }

  if (segment.segmentType === 'audio') {
    const durationMs = Math.max(0, endTime - startTime)
    return {
      ...base,
      fadeInDuration: normalizeFadeDuration(segment.fadeInDuration, durationMs),
      fadeOutDuration: normalizeFadeDuration(segment.fadeOutDuration, durationMs),
    }
  }

  return base
}

function createSegmentLookup(protocol: IVideoProtocol): SegmentLookup {
  const audioById = new Map<string, IAudioSegment>()
  const videoById = new Map<string, IVideoFramesSegment>()

  for (const track of protocol.tracks) {
    // Muted tracks are silent in export, mirroring the preview evaluator.
    if (track.muted === true)
      continue
    for (const segment of track.children) {
      if (segment.segmentType === 'audio')
        audioById.set(segment.id, segment)
      else if (segment.segmentType === 'frames' && segment.type === 'video')
        videoById.set(segment.id, segment)
    }
  }

  return { audioById, videoById }
}

function collectEvaluationBoundaries(lookup: SegmentLookup): number[] {
  const boundaries = new Set<number>([0])
  for (const segment of lookup.audioById.values())
    addBoundaries(boundaries, segment.startTime, segment.endTime)
  for (const segment of lookup.videoById.values())
    addBoundaries(boundaries, segment.startTime, segment.endTime)
  return [...boundaries].sort((a, b) => a - b)
}

function addBoundaries(boundaries: Set<number>, startTime: number, endTime: number) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime))
    return
  if (endTime <= startTime)
    return
  boundaries.add(Math.max(0, startTime))
  boundaries.add(Math.max(0, endTime))
}

function lookupSegment(
  segmentKind: 'audio' | 'video',
  segmentId: string,
  lookup: SegmentLookup,
): IAudioSegment | IVideoFramesSegment | undefined {
  if (segmentKind === 'audio')
    return lookup.audioById.get(segmentId)
  return lookup.videoById.get(segmentId)
}

function lookupSegmentEnd(runtime: ActiveVoiceRuntime, lookup: SegmentLookup): number {
  const segment = lookupSegment(runtime.segmentKind, runtime.segmentId, lookup)
  if (!segment)
    return runtime.startTime
  return segment.endTime
}

function readSegmentFromTime(segment: IAudioSegment | IVideoFramesSegment): number {
  if (typeof segment.fromTime !== 'number' || !Number.isFinite(segment.fromTime))
    return 0
  return Math.max(0, segment.fromTime)
}

function readSegmentPlayRate(segment: IAudioSegment | IVideoFramesSegment): number {
  return normalizePlayRate(segment.playRate)
}

function readSegmentVolume(segment: IAudioSegment | IVideoFramesSegment): number {
  return normalizeVolume(segment.volume)
}

function normalizeFadeDuration(durationMs: number | undefined, maxDurationMs: number): number {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs))
    return 0
  return Math.max(0, Math.min(durationMs, maxDurationMs))
}

function normalizePlayRate(playRate: number | undefined): number {
  if (typeof playRate !== 'number' || !Number.isFinite(playRate))
    return 1
  return Math.max(0.1, Math.min(100, playRate))
}

function normalizeVolume(volume: number | undefined): number {
  if (typeof volume !== 'number' || !Number.isFinite(volume))
    return 1
  return Math.max(0, Math.min(1, volume))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
