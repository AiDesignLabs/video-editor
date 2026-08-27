import type { ITrackType, ITransform } from '@video-editor/shared'

export type AudioVoiceAction = 'start' | 'stop' | 'seek' | 'gain' | 'rate'

export interface TransportSnapshot {
  playing: boolean
  timelineMs: number
  rate: number
  epochWallMs: number
  epochTimelineMs: number
  discontinuitySeq: number
}

export interface EvalContext {
  atMs: number
  windowStartMs: number
  windowEndMs: number
  fps: number
  discontinuity?: boolean
}

export interface VisualPlanItem {
  segmentId: string
  trackId: string
  trackType: ITrackType
  segmentType: ITrackType
  zOrder: number
  sourceTimeMs: number
  opacity: number
  transform?: ITransform
  transition?: {
    fromSegmentId: string
    toSegmentId: string
    progress: number
    durationMs: number
    transitionId?: string
    transitionName?: string
  }
  effects?: VisualEffectParam[]
}

export interface VisualTrackEffectParam {
  segmentType: 'effect'
  segmentId: string
  effectId: string
  name: string
}

export interface VisualTrackFilterParam {
  segmentType: 'filter'
  segmentId: string
  filterId: string
  name: string
  intensity: number
}

export type VisualEffectParam = VisualTrackEffectParam | VisualTrackFilterParam

export interface AudioPlanEvent {
  voiceId: string
  segmentId: string
  trackId: string
  segmentKind: 'audio' | 'video'
  action: AudioVoiceAction
  atTimelineMs: number
  sourceTimeMs?: number
  gain?: number
  rate?: number
}

export interface TimelinePlan {
  atMs: number
  windowStartMs: number
  windowEndMs: number
  visuals: VisualPlanItem[]
  audioEvents: AudioPlanEvent[]
}

export interface ActiveVoiceRef {
  voiceId: string
  segmentId: string
  trackId: string
  segmentKind: 'audio' | 'video'
}

export interface EvaluatorState {
  activeVoices: ActiveVoiceRef[]
}

export interface EvaluatorOutput {
  plan: TimelinePlan
  state: EvaluatorState
}
