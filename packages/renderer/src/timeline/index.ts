export { createPreviewAudioTicker } from './audio-ticker'
export type {
  CreatePreviewAudioTickerOptions,
  PreviewAudioTicker,
} from './audio-ticker'

export { createComposeAudioInputs } from './compose-audio-plan'

export type { ComposeAudioInput } from './compose-audio-plan'
export { createComposeRunner } from './compose-runner'

export type {
  ComposeRunner,
  ComposeRunnerEvaluateOptions,
} from './compose-runner'
export {
  createEmptyEvaluatorState,
  evaluateTimelinePlan,
} from './evaluator'

export type {
  EffectDefinition,
  EffectFilterOptions,
  EffectUniformDeclaration,
  ShaderEffectContext,
} from './effect-registry'
export {
  buildEffectFilters,
  EFFECT_UNIFORM_GROUP,
  getEffectDefinition,
  listEffectDefinitions,
  registerEffect,
  structuralKeyForEffect,
  unregisterEffect,
} from './effect-registry'
export { cubicBezierEase, findKeyframeTrack, sampleFrames, sampleKeyframes, sampleSegmentKeyframe, sampleVisualKeyframes } from './keyframes'
export {
  computePaletteMatrix,
  computePalettePostUniforms,
  createPalettePostFilter,
  PALETTE_NEUTRAL,
  paletteNeedsPostShader,
  paletteStructuralKey,
  paletteToColorMatrix,
  updatePaletteColorMatrixFilter,
  updatePalettePostFilter,
} from './palette-filter'
export { createPixiFiltersFromVisualEffects, resolveEffectDefinition } from './pixi-effects'
export { createSegmentFilterCache } from './segment-filter-cache'
export type { SegmentFilterCache, SegmentFilterCacheDeps, SegmentFilterEntry } from './segment-filter-cache'
export { createPreviewRunner } from './preview-runner'

export type {
  CreatePreviewRunnerOptions,
  PreviewRunner,
} from './preview-runner'
export { collectTransitionByFromSegmentId } from './transition-resolver'

export type { ResolvedTransitionEdge } from './transition-resolver'
export { createTimelineTransport } from './transport'
export type {
  CreateTimelineTransportOptions,
  TimelineTransport,
} from './transport'
export type {
  ActiveVoiceRef,
  AudioPlanEvent,
  AudioVoiceAction,
  EvalContext,
  EvaluatorOutput,
  EvaluatorState,
  TimelinePlan,
  TransportSnapshot,
  VisualEffectParam,
  VisualPlanItem,
  VisualTrackEffectParam,
  VisualTrackFilterParam,
} from './types'
export { createVisualRenderItems } from './visual-plan'

export type { VisualRenderItem } from './visual-plan'
