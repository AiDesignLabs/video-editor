import type { Filter } from 'pixi.js'
import type { EffectDefinition } from './effect-registry'
import type { VisualEffectParam } from './types'
import { BlurFilter, ColorMatrixFilter } from 'pixi.js'
import { buildEffectFilters, getEffectDefinition, registerEffect } from './effect-registry'

export function createPixiFiltersFromVisualEffects(effects: VisualEffectParam[] | undefined): Filter[] {
  if (!effects?.length)
    return []

  const filters: Filter[] = []
  for (const effect of effects) {
    const definition = resolveEffectDefinition(effect)
    if (definition)
      filters.push(...buildEffectFilters(definition, effect))
  }
  return filters
}

/**
 * Resolve the definition backing an effect: registered ids win, unknown ids
 * fall back to legacy name-substring matching which maps onto the same
 * definitions (so the legacy path gets the per-frame update path too).
 */
export function resolveEffectDefinition(param: VisualEffectParam): EffectDefinition | undefined {
  return getEffectDefinition(param) ?? resolveLegacyDefinition(param)
}

function readIntensity(param: VisualEffectParam): number {
  return normalizeIntensity(param.segmentType === 'filter' ? param.intensity : 1)
}

/**
 * A ColorMatrix-preset definition: builds a fresh filter and, on every frame,
 * resets and re-applies the preset so keyframed intensity is honoured without
 * rebuilding the filter.
 */
function colorMatrixEffect(
  id: string,
  label: string,
  apply: (matrix: ColorMatrixFilter, intensity: number) => void,
): EffectDefinition {
  const applyTo = (filters: Filter[], param: VisualEffectParam) => {
    const matrix = filters[0]
    if (!(matrix instanceof ColorMatrixFilter))
      return
    matrix.reset()
    apply(matrix, readIntensity(param))
  }
  return {
    id,
    label,
    build: (param) => {
      const matrix = new ColorMatrixFilter()
      applyTo([matrix], param)
      return [matrix]
    },
    update: applyTo,
  }
}

function blurStrength(intensity: number): number {
  return 1 + intensity * 14
}

function applyBlur(filters: Filter[], strength: number) {
  const blur = filters[0]
  if (blur instanceof BlurFilter)
    blur.strength = strength
}

const BLUR_DEFINITION: EffectDefinition = {
  id: 'blur',
  label: 'Blur',
  build: param => [new BlurFilter({ strength: blurStrength(readIntensity(param)), quality: 2, kernelSize: 5 })],
  update: (filters, param) => applyBlur(filters, blurStrength(readIntensity(param))),
}

// Built-in definitions keyed by canonical effectId/filterId.
const BUILT_INS: EffectDefinition[] = [
  BLUR_DEFINITION,
  colorMatrixEffect('grayscale', 'Grayscale', (m, i) => m.grayscale(i, false)),
  colorMatrixEffect('sepia', 'Sepia', m => m.sepia(false)),
  colorMatrixEffect('negative', 'Negative', m => m.negative(false)),
  colorMatrixEffect('vintage', 'Vintage', m => m.vintage(false)),
  colorMatrixEffect('contrast', 'Contrast', (m, i) => m.contrast(0.5 + i * 0.5, false)),
  colorMatrixEffect('brightness', 'Brightness', (m, i) => m.brightness(0.5 + i, false)),
  colorMatrixEffect('saturate', 'Saturate', (m, i) => m.saturate(i, false)),
  colorMatrixEffect('cool', 'Cool', (m, i) => m.hue(-20 * i, false)),
  colorMatrixEffect('sharpen', 'Sharpen', m => m.contrast(0.75, false)),
]

for (const definition of BUILT_INS)
  registerEffect(definition)

const BUILT_IN_BY_ID = new Map(BUILT_INS.map(definition => [definition.id, definition]))

function builtIn(id: string): EffectDefinition {
  const definition = BUILT_IN_BY_ID.get(id)
  if (!definition)
    throw new Error(`[renderer] missing built-in effect definition "${id}"`)
  return definition
}

/** Legacy fallback for filter tracks whose name matches nothing else. */
const LEGACY_DESATURATE = colorMatrixEffect('legacy:desaturate', 'Desaturate', (m, i) => m.saturate(-0.3 * i, false))

/** Legacy fallback for effect tracks: a fixed soft blur, intensity-independent. */
const LEGACY_SOFT_BLUR: EffectDefinition = {
  id: 'legacy:soft-blur',
  label: 'Soft Blur',
  build: () => [new BlurFilter({ strength: 4, quality: 2, kernelSize: 5 })],
  update: filters => applyBlur(filters, 4),
}

function resolveLegacyDefinition(param: VisualEffectParam): EffectDefinition | undefined {
  return param.segmentType === 'filter'
    ? resolveLegacyFilterDefinition(param)
    : resolveLegacyEffectDefinition(param)
}

function resolveLegacyFilterDefinition(effect: Extract<VisualEffectParam, { segmentType: 'filter' }>): EffectDefinition {
  const token = normalizeToken(effect.name, effect.filterId)

  if (looksLikeBlur(token))
    return builtIn('blur')
  if (looksLikeGray(token))
    return builtIn('grayscale')
  if (token.includes('sepia') || token.includes('warm'))
    return builtIn('sepia')
  if (token.includes('negative') || token.includes('invert'))
    return builtIn('negative')
  if (token.includes('vintage') || token.includes('retro'))
    return builtIn('vintage')
  if (token.includes('contrast'))
    return builtIn('contrast')
  if (token.includes('brightness') || token.includes('bright'))
    return builtIn('brightness')
  if (token.includes('saturate') || token.includes('vivid'))
    return builtIn('saturate')
  if (token.includes('cool'))
    return builtIn('cool')

  return LEGACY_DESATURATE
}

function resolveLegacyEffectDefinition(effect: Extract<VisualEffectParam, { segmentType: 'effect' }>): EffectDefinition | undefined {
  const token = normalizeToken(effect.name, effect.effectId)
  if (looksLikeBlur(token) || token.includes('glow') || token.includes('dream') || token.includes('soft'))
    return LEGACY_SOFT_BLUR
  if (token.includes('vintage') || token.includes('retro'))
    return builtIn('vintage')
  if (token.includes('sharpen') || token.includes('clarity'))
    return builtIn('sharpen')
  return undefined
}

function looksLikeBlur(token: string): boolean {
  return token.includes('blur') || token.includes('gaussian')
}

function looksLikeGray(token: string): boolean {
  return token.includes('grayscale')
    || token.includes('grey')
    || token.includes('gray')
    || token.includes('mono')
    || token.includes('blackwhite')
    || token.includes('bw')
}

function normalizeToken(...parts: string[]): string {
  return parts
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function normalizeIntensity(value: number): number {
  if (!Number.isFinite(value))
    return 1
  return Math.min(Math.max(value, 0), 1)
}
