import type { Filter } from 'pixi.js'
import type { VisualEffectParam } from './types'
import { BlurFilter, ColorMatrixFilter } from 'pixi.js'
import { getEffectDefinition, registerEffect } from './effect-registry'

export function createPixiFiltersFromVisualEffects(effects: VisualEffectParam[] | undefined): Filter[] {
  if (!effects?.length)
    return []

  const filters: Filter[] = []
  for (const effect of effects) {
    // Registered ids win; unknown ids fall back to legacy name matching.
    const definition = getEffectDefinition(effect)
    if (definition) {
      filters.push(...definition.build(effect))
      continue
    }
    const filter = effect.segmentType === 'filter'
      ? buildFilterTrackEffect(effect)
      : buildNamedEffect(effect)
    if (filter)
      filters.push(filter)
  }
  return filters
}

function readIntensity(param: VisualEffectParam): number {
  return normalizeIntensity(param.segmentType === 'filter' ? param.intensity : 1)
}

function colorMatrix(apply: (matrix: ColorMatrixFilter, intensity: number) => void) {
  return (param: VisualEffectParam): Filter[] => {
    const matrix = new ColorMatrixFilter()
    apply(matrix, readIntensity(param))
    return [matrix]
  }
}

// Built-in definitions keyed by canonical effectId/filterId.
registerEffect({
  id: 'blur',
  label: 'Blur',
  build: param => [new BlurFilter({ strength: 1 + readIntensity(param) * 14, quality: 2, kernelSize: 5 })],
})
registerEffect({ id: 'grayscale', label: 'Grayscale', build: colorMatrix((m, i) => m.grayscale(i, false)) })
registerEffect({ id: 'sepia', label: 'Sepia', build: colorMatrix(m => m.sepia(false)) })
registerEffect({ id: 'negative', label: 'Negative', build: colorMatrix(m => m.negative(false)) })
registerEffect({ id: 'vintage', label: 'Vintage', build: colorMatrix(m => m.vintage(false)) })
registerEffect({ id: 'contrast', label: 'Contrast', build: colorMatrix((m, i) => m.contrast(0.5 + i * 0.5, false)) })
registerEffect({ id: 'brightness', label: 'Brightness', build: colorMatrix((m, i) => m.brightness(0.5 + i, false)) })
registerEffect({ id: 'saturate', label: 'Saturate', build: colorMatrix((m, i) => m.saturate(i, false)) })
registerEffect({ id: 'cool', label: 'Cool', build: colorMatrix((m, i) => m.hue(-20 * i, false)) })
registerEffect({ id: 'sharpen', label: 'Sharpen', build: colorMatrix(m => m.contrast(0.75, false)) })

function buildFilterTrackEffect(effect: Extract<VisualEffectParam, { segmentType: 'filter' }>): Filter | undefined {
  const token = normalizeToken(effect.name, effect.filterId)
  const intensity = normalizeIntensity(effect.intensity)

  if (looksLikeBlur(token))
    return new BlurFilter({ strength: 1 + intensity * 14, quality: 2, kernelSize: 5 })

  const matrix = new ColorMatrixFilter()
  if (looksLikeGray(token))
    matrix.grayscale(intensity, false)
  else if (token.includes('sepia') || token.includes('warm'))
    matrix.sepia(false)
  else if (token.includes('negative') || token.includes('invert'))
    matrix.negative(false)
  else if (token.includes('vintage') || token.includes('retro'))
    matrix.vintage(false)
  else if (token.includes('contrast'))
    matrix.contrast(0.5 + intensity * 0.5, false)
  else if (token.includes('brightness') || token.includes('bright'))
    matrix.brightness(0.5 + intensity, false)
  else if (token.includes('saturate') || token.includes('vivid'))
    matrix.saturate(intensity, false)
  else if (token.includes('cool'))
    matrix.hue(-20 * intensity, false)
  else
    matrix.saturate(-0.3 * intensity, false)

  return matrix
}

function buildNamedEffect(effect: Extract<VisualEffectParam, { segmentType: 'effect' }>): Filter | undefined {
  const token = normalizeToken(effect.name, effect.effectId)
  if (looksLikeBlur(token) || token.includes('glow') || token.includes('dream') || token.includes('soft'))
    return new BlurFilter({ strength: 4, quality: 2, kernelSize: 5 })

  if (token.includes('vintage') || token.includes('retro')) {
    const matrix = new ColorMatrixFilter()
    matrix.vintage(false)
    return matrix
  }

  if (token.includes('sharpen') || token.includes('clarity')) {
    const matrix = new ColorMatrixFilter()
    matrix.contrast(0.75, false)
    return matrix
  }

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
