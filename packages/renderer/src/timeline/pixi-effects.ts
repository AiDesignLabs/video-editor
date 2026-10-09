import type { Filter } from 'pixi.js'
import type { EffectDefinition, EffectDefinitionKind } from './effect-registry'
import type { VisualEffectParam } from './types'
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom'
import { CRTFilter } from 'pixi-filters/crt'
import { GlitchFilter } from 'pixi-filters/glitch'
import { GlowFilter } from 'pixi-filters/glow'
import { MotionBlurFilter } from 'pixi-filters/motion-blur'
import { OldFilmFilter } from 'pixi-filters/old-film'
import { RadialBlurFilter } from 'pixi-filters/radial-blur'
import { RGBSplitFilter } from 'pixi-filters/rgb-split'
import { ShockwaveFilter } from 'pixi-filters/shockwave'
import { TwistFilter } from 'pixi-filters/twist'
import { ZoomBlurFilter } from 'pixi-filters/zoom-blur'
import { BlurFilter, ColorMatrixFilter } from 'pixi.js'
import { buildEffectFilters, getEffectDefinition, readFilterUniforms, registerEffect } from './effect-registry'

import { CUSTOM_EFFECT_SHADERS } from './shaders/catalog'

const { CHROMATIC, DUOTONE, GLITCH, GLOW, GRAIN, JITTER, LIGHT_LEAK, PIXELATE, PIXELATE_PULSE, POSTERIZE, PULSE_BLUR, PULSE_GLOW, RGB_SPLIT, SCANLINES, SHARPEN, VIGNETTE } = CUSTOM_EFFECT_SHADERS

export function createPixiFiltersFromVisualEffects(effects: VisualEffectParam[] | undefined): Filter[] {
  if (!effects?.length)
    return []
  const filters: Filter[] = []
  for (const effect of effects) {
    const definition = resolveEffectDefinition(effect)
    if (!definition)
      continue
    const built = buildEffectFilters(definition, effect)
    // Keep this convenience API consistent with the frame cache: shader
    // uniforms must receive the segment's initial intensity immediately.
    definition.update?.(built, effect, { timeMs: 0, sourceTimeMs: 0 })
    filters.push(...built)
  }
  return filters
}

/** Registered ids win; legacy names still resolve for older project files. */
export function resolveEffectDefinition(param: VisualEffectParam): EffectDefinition | undefined {
  return getEffectDefinition(param) ?? resolveLegacyDefinition(param)
}

function readIntensity(param: VisualEffectParam): number {
  return normalizeIntensity(param.segmentType === 'filter' ? param.intensity : 1)
}

function readUniforms(filters: Filter[]) {
  return filters[0] ? readFilterUniforms(filters[0]) : undefined
}

/** ColorMatrix presets are kept for cheap, deterministic grading effects. */
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
    kind: 'filter',
    build: (param) => {
      const matrix = new ColorMatrixFilter()
      applyTo([matrix], param)
      return [matrix]
    },
    update: applyTo,
  }
}

function shaderEffect(id: string, label: string, fragment: string, padding = 0, kind: EffectDefinitionKind = 'filter'): EffectDefinition {
  return {
    id,
    label,
    kind,
    fragment,
    uniforms: { uAmount: { value: 1, type: 'f32' }, uTime: { value: 0, type: 'f32' } },
    filterOptions: padding ? { padding } : undefined,
    update: (filters, param, ctx) => {
      const uniforms = readUniforms(filters)
      if (!uniforms)
        return
      uniforms.uAmount = readIntensity(param)
      uniforms.uTime = ctx.timeMs / 1000
    },
  }
}

function externalFilterEffect<T extends Filter>(
  id: string,
  label: string,
  kind: EffectDefinitionKind,
  create: (amount: number) => T,
  update: (filter: T, amount: number, ctx: { timeMs: number, sourceTimeMs: number }) => void,
): EffectDefinition {
  return {
    id,
    label,
    kind,
    build: param => [create(readIntensity(param))],
    update: (filters, param, ctx) => {
      const filter = filters[0]
      if (filter)
        update(filter as T, readIntensity(param), ctx)
    },
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
  label: 'Soft Blur',
  kind: 'filter',
  build: param => [new BlurFilter({ strength: blurStrength(readIntensity(param)), quality: 3, kernelSize: 7 })],
  update: (filters, param) => applyBlur(filters, blurStrength(readIntensity(param))),
}

const PIXI_FILTER_DEFINITIONS: EffectDefinition[] = [
  externalFilterEffect('bloom', 'Bloom', 'filter', amount => new AdvancedBloomFilter({
    threshold: 0.45,
    bloomScale: 0.45 + amount * 0.9,
    brightness: 1 + amount * 0.6,
    blur: 2,
    quality: 4,
  }), (filter, amount) => {
    filter.bloomScale = 0.45 + amount * 0.9
    filter.brightness = 1 + amount * 0.6
  }),
  externalFilterEffect('glow-pro', 'Glow', 'filter', amount => new GlowFilter({
    distance: 10 + amount * 12,
    outerStrength: 1 + amount * 5,
    innerStrength: amount,
    quality: 0.2,
  }), (filter, amount) => {
    filter.distance = 10 + amount * 12
    filter.outerStrength = 1 + amount * 5
    filter.innerStrength = amount
  }),
  externalFilterEffect('motion-blur', 'Motion Blur', 'filter', amount => new MotionBlurFilter({
    velocity: [amount * 16, 0],
    kernelSize: 7,
  }), (filter, amount) => {
    filter.velocityX = amount * 16
  }),
  externalFilterEffect('radial-blur', 'Radial Blur', 'filter', amount => new RadialBlurFilter({
    angle: amount * 3,
    radius: -1,
    kernelSize: 7,
  }), (filter, amount) => {
    filter.angle = amount * 3
  }),
  externalFilterEffect('rgb-split-pro', 'RGB Split', 'filter', amount => new RGBSplitFilter({
    red: [-amount * 10, 0],
    green: [0, amount * 10],
  }), (filter, amount) => {
    filter.redX = -amount * 10
    filter.greenY = amount * 10
  }),
  externalFilterEffect('twist', 'Twist', 'filter', amount => new TwistFilter({
    radius: 360,
    angle: amount * 2.5,
    padding: 32,
  }), (filter, amount) => {
    filter.angle = amount * 2.5
  }),
  externalFilterEffect('zoom-blur', 'Zoom Blur', 'filter', amount => new ZoomBlurFilter({
    strength: amount * 0.18,
    center: [0.5, 0.5],
  }), (filter, amount) => {
    filter.strength = amount * 0.18
  }),
  externalFilterEffect('crt', 'CRT', 'effect', amount => new CRTFilter({
    curvature: 1.5,
    lineWidth: 1.5,
    lineContrast: 0.2 + amount * 0.3,
    noise: amount * 0.35,
    vignetting: 0.2 + amount * 0.25,
  }), (filter, amount, ctx) => {
    filter.time = ctx.timeMs / 1000
    filter.noise = amount * 0.35
    filter.lineContrast = 0.2 + amount * 0.3
  }),
  externalFilterEffect('glitch-pro', 'Glitch', 'effect', amount => new GlitchFilter({
    slices: 8,
    offset: 8 + amount * 64,
    fillMode: 1,
  }), (filter, amount, ctx) => {
    filter.offset = 8 + amount * 64
    filter.seed = Math.floor(ctx.timeMs / 35)
  }),
  externalFilterEffect('old-film', 'Old Film', 'effect', amount => new OldFilmFilter({
    sepia: amount * 0.35,
    noise: amount * 0.35,
    scratch: amount * 0.35,
    scratchDensity: amount * 0.3,
    vignetting: 0.3,
  }), (filter, amount, ctx) => {
    filter.sepia = amount * 0.35
    filter.noise = amount * 0.35
    filter.scratch = amount * 0.35
    filter.seed = Math.floor(ctx.timeMs / 45)
  }),
  externalFilterEffect('shockwave', 'Shockwave', 'effect', amount => new ShockwaveFilter({
    center: { x: 0.5, y: 0.5 },
    amplitude: 8 + amount * 26,
    wavelength: 120,
    brightness: 1 + amount,
    speed: 450,
  }), (filter, amount, ctx) => {
    filter.time = ctx.timeMs / 1000
    filter.amplitude = 8 + amount * 26
  }),
]

const BUILT_INS: EffectDefinition[] = [
  BLUR_DEFINITION,
  ...PIXI_FILTER_DEFINITIONS,
  // `ColorMatrixFilter.grayscale(scale)` uses scale as a luminance multiplier,
  // so using it directly would darken the frame instead of blending toward
  // grayscale. Saturation gives the expected 0..1 strength semantics.
  colorMatrixEffect('grayscale', 'Grayscale', (m, i) => m.saturate(-i, false)),
  colorMatrixEffect('sepia', 'Sepia', (m, i) => {
    m.sepia(false)
    if (i < 1)
      m.saturate(1 - i, true)
  }),
  colorMatrixEffect('negative', 'Negative', (m, i) => {
    m.negative(false)
    if (i < 1)
      m.saturate(1 - i, true)
  }),
  colorMatrixEffect('vintage', 'Vintage', (m, i) => {
    m.vintage(false)
    m.brightness(1 + i * 0.08, true)
  }),
  colorMatrixEffect('contrast', 'Contrast', (m, i) => m.contrast(1 + i * 0.9, false)),
  colorMatrixEffect('brightness', 'Brightness', (m, i) => m.brightness(1 + i * 0.7, false)),
  colorMatrixEffect('saturate', 'Vivid', (m, i) => m.saturate(1 + i * 1.25, false)),
  colorMatrixEffect('cool', 'Cool', (m, i) => {
    m.hue(-22 * i, false)
    m.saturate(1 + i * 0.2, true)
  }),
  colorMatrixEffect('warm', 'Warm', (m, i) => {
    m.hue(18 * i, false)
    m.brightness(1 + i * 0.08, true)
  }),
  colorMatrixEffect('cinematic', 'Cinematic', (m, i) => {
    m.contrast(1 + i * 0.7, false)
    m.saturate(1 - i * 0.2, true)
    m.hue(-8 * i, true)
  }),
  colorMatrixEffect('faded', 'Faded', (m, i) => {
    m.saturate(1 - i * 0.65, false)
    m.brightness(1 + i * 0.12, true)
  }),
  shaderEffect('sharpen', 'Sharpen', SHARPEN, 8),
  shaderEffect('glow', 'Glow', GLOW, 12),
  shaderEffect('chromatic-aberration', 'Chromatic Aberration', CHROMATIC, 8),
  shaderEffect('pixelate', 'Pixelate', PIXELATE),
  shaderEffect('vignette', 'Vignette', VIGNETTE),
  shaderEffect('posterize', 'Posterize', POSTERIZE),
  shaderEffect('duotone', 'Duotone', DUOTONE),
  shaderEffect('pulse-blur', 'Pulse Blur', PULSE_BLUR, 8, 'effect'),
  shaderEffect('pulse-glow', 'Pulse Glow', PULSE_GLOW, 12, 'effect'),
  shaderEffect('rgb-split', 'RGB Split', RGB_SPLIT, 12, 'effect'),
  shaderEffect('pixelate-pulse', 'Pixelate Pulse', PIXELATE_PULSE, 8, 'effect'),
  shaderEffect('jitter', 'Jitter', JITTER, 8, 'effect'),
  shaderEffect('film-grain', 'Film Grain', GRAIN, 0, 'effect'),
  shaderEffect('scanlines', 'Scanlines', SCANLINES, 0, 'effect'),
  shaderEffect('glitch', 'Glitch', GLITCH, 0, 'effect'),
  shaderEffect('light-leak', 'Light Leak', LIGHT_LEAK, 0, 'effect'),
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

const LEGACY_DESATURATE = colorMatrixEffect('legacy:desaturate', 'Desaturate', (m, i) => m.saturate(1 - i, false))

function resolveLegacyDefinition(param: VisualEffectParam): EffectDefinition | undefined {
  return param.segmentType === 'filter' ? resolveLegacyFilterDefinition(param) : resolveLegacyEffectDefinition(param)
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
  if (token.includes('cinematic') || token.includes('film'))
    return builtIn('cinematic')
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
  if (looksLikeBlur(token) || token.includes('soft'))
    return builtIn('pulse-blur')
  if (token.includes('glow') || token.includes('light'))
    return token.includes('leak') ? builtIn('light-leak') : builtIn('pulse-glow')
  if (token.includes('glitch'))
    return builtIn('glitch')
  if (token.includes('pixel'))
    return builtIn('pixelate-pulse')
  if (token.includes('chrom') || token.includes('rgb'))
    return builtIn('rgb-split')
  if (token.includes('grain') || token.includes('noise'))
    return builtIn('film-grain')
  if (token.includes('scanline'))
    return builtIn('scanlines')
  return undefined
}

function looksLikeBlur(token: string): boolean {
  return token.includes('blur') || token.includes('gaussian')
}

function looksLikeGray(token: string): boolean {
  return token.includes('grayscale') || token.includes('grey') || token.includes('gray') || token.includes('mono') || token.includes('blackwhite') || token.includes('bw')
}

function normalizeToken(...parts: string[]): string {
  return parts.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizeIntensity(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(Math.max(value!, 0), 1) : 1
}
