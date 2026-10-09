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
export { definitionLabelKey, resolveDefinitionLabel } from './definition-label'

export type {
  EffectDefinition,
  EffectDefinitionKind,
  EffectFilterOptions,
  EffectUniformDeclaration,
  ShaderEffectContext,
} from './effect-registry'
export {
  buildEffectFilters,
  EFFECT_UNIFORM_GROUP,
  getEffectDefinition,
  listEffectDefinitions,
  listFilterDefinitions,
  listVisualEffectDefinitions,
  registerEffect,
  structuralKeyForEffect,
  unregisterEffect,
} from './effect-registry'
export {
  createEmptyEvaluatorState,
  evaluateTimelinePlan,
} from './evaluator'
export { cubicBezierEase, findKeyframeTrack, sampleFrames, sampleKeyframes, sampleSegmentKeyframe, sampleVisualKeyframes } from './keyframes'
export {
  CHROMA_KEY_UNIFORM_GROUP,
  computeChromaKeyUniforms,
  computeMaskUniforms,
  createChromaKeyFilter,
  createMaskFilter,
  hexToRgb01,
  MASK_UNIFORM_GROUP,
  maskChromaStructuralKey,
  updateChromaKeyFilter,
  updateMaskFilter,
} from './mask-chroma'
export type { ChromaKeyUniforms, MaskUniforms } from './mask-chroma'
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
export { createPresetPreview } from './preset-preview'
export type { PresetPreview, PresetPreviewDefinition, PresetPreviewKind, PresetPreviewOptions, PresetPreviewRenderOptions } from './preset-preview'
export { createPreviewRunner } from './preview-runner'
export type {
  CreatePreviewRunnerOptions,
  PreviewRunner,
} from './preview-runner'
export { createSegmentFilterCache } from './segment-filter-cache'

export type { SegmentAppearanceInput, SegmentFilterCache, SegmentFilterCacheDeps, SegmentFilterEntry, SegmentTransitionInput } from './segment-filter-cache'
export {
  buildTransitionFilters,
  getTransitionDefinition,
  listTransitionDefinitions,
  registerTransition,
  TRANSITION_UNIFORM_GROUP,
  transitionStructuralKey,
  unregisterTransition,
  updateTransitionFilters,
} from './transition-registry'
export type {
  TransitionDefinition,
  TransitionRenderContext,
  TransitionRole,
} from './transition-registry'
export { collectTransitionByFromSegmentId } from './transition-resolver'

export type { ResolvedTransitionEdge } from './transition-resolver'
// Side-effect import: registers the built-in shader transitions.
export { BUILT_IN_TRANSITIONS } from './transitions'
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

export type { VisualRenderItem, VisualRenderTransition } from './visual-plan'
