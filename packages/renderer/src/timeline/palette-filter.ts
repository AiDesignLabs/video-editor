import type { IPalette } from '@video-editor/shared'
import type { ColorMatrix as PixiColorMatrix } from 'pixi.js'
import { ColorMatrixFilter } from 'pixi.js'

export const PALETTE_NEUTRAL: IPalette = {
  temperature: 6500,
  hue: 0,
  saturation: 0,
  brightness: 0,
  contrast: 0,
  shine: 0,
  highlight: 0,
  shadow: 0,
  sharpness: 0,
  vignette: 0,
  fade: 0,
  grain: 0,
}

type ColorMatrix = number[] // 4x5 row-major, 20 entries, offsets normalized 0..1

const IDENTITY: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
]

/**
 * Compose the color-matrix for a palette. Returns null when every
 * matrix-expressible field is neutral.
 *
 * Approximations (documented, not colorimetric):
 * - temperature: red/blue channel gains around the 6500K neutral point
 * - shine: mild combined brightness + contrast lift
 * - highlight: bright-range gain approximated by an overall gain
 * - shadow: dark-range lift approximated by a constant offset
 * - fade: desaturation + slight offset toward gray
 * `sharpness`, `vignette` and `grain` are not expressible as a color matrix
 * and are ignored here (custom shader follow-up).
 */
export function computePaletteMatrix(palette: IPalette): ColorMatrix | null {
  let matrix = IDENTITY
  let touched = false

  const temperature = clamp(palette.temperature, 1000, 40000)
  if (Math.abs(temperature - 6500) > 1) {
    // Log-scaled deviation from neutral: warm (>6500) boosts red, cool boosts blue.
    const deviation = clamp(Math.log(temperature / 6500) / Math.log(40000 / 6500), -1, 1)
    const rGain = 1 + deviation * 0.25
    const bGain = 1 - deviation * 0.25
    matrix = multiply(scaleMatrix(rGain, 1, bGain), matrix)
    touched = true
  }

  const hue = clamp(palette.hue, -1, 1)
  if (hue !== 0) {
    matrix = multiply(hueMatrix(hue * 180), matrix)
    touched = true
  }

  const saturation = clamp(palette.saturation, -1, 1)
  if (saturation !== 0) {
    matrix = multiply(saturationMatrix(1 + saturation), matrix)
    touched = true
  }

  const brightness = clamp(palette.brightness, -1, 1)
  if (brightness !== 0) {
    const gain = 1 + brightness * 0.6
    matrix = multiply(scaleMatrix(gain, gain, gain), matrix)
    touched = true
  }

  const contrast = clamp(palette.contrast, -1, 1)
  if (contrast !== 0) {
    const slope = 1 + contrast * 0.6
    const offset = 0.5 * (1 - slope)
    matrix = multiply(contrastMatrix(slope, offset), matrix)
    touched = true
  }

  const shine = clamp(palette.shine, -1, 1)
  if (shine !== 0) {
    const gain = 1 + shine * 0.15
    const slope = 1 + shine * 0.1
    matrix = multiply(contrastMatrix(slope, 0.5 * (1 - slope)), multiply(scaleMatrix(gain, gain, gain), matrix))
    touched = true
  }

  const highlight = clamp(palette.highlight, -1, 1)
  if (highlight !== 0) {
    const gain = 1 + highlight * 0.2
    matrix = multiply(scaleMatrix(gain, gain, gain), matrix)
    touched = true
  }

  const shadow = clamp(palette.shadow, -1, 1)
  if (shadow !== 0) {
    matrix = multiply(offsetMatrix(shadow * 0.08), matrix)
    touched = true
  }

  const fade = clamp(palette.fade, 0, 1)
  if (fade > 0) {
    matrix = multiply(offsetMatrix(fade * 0.06), multiply(saturationMatrix(1 - fade * 0.5), matrix))
    touched = true
  }

  return touched ? matrix : null
}

/** Build a Pixi filter for the palette, or null when it is neutral. */
export function paletteToColorMatrix(palette: IPalette): ColorMatrixFilter | null {
  const matrix = computePaletteMatrix(palette)
  if (!matrix)
    return null
  const filter = new ColorMatrixFilter()
  filter.matrix = [...matrix] as unknown as PixiColorMatrix
  return filter
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value))
    return (min + max) / 2 === 0 ? 0 : min
  return Math.min(max, Math.max(min, value))
}

function scaleMatrix(r: number, g: number, b: number): ColorMatrix {
  return [
    r, 0, 0, 0, 0,
    0, g, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

function offsetMatrix(offset: number): ColorMatrix {
  return [
    1, 0, 0, 0, offset,
    0, 1, 0, 0, offset,
    0, 0, 1, 0, offset,
    0, 0, 0, 1, 0,
  ]
}

function contrastMatrix(slope: number, offset: number): ColorMatrix {
  return [
    slope, 0, 0, 0, offset,
    0, slope, 0, 0, offset,
    0, 0, slope, 0, offset,
    0, 0, 0, 1, 0,
  ]
}

// Rec. 709 luma weights.
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

function saturationMatrix(amount: number): ColorMatrix {
  const inv = 1 - amount
  return [
    inv * LUMA_R + amount, inv * LUMA_G, inv * LUMA_B, 0, 0,
    inv * LUMA_R, inv * LUMA_G + amount, inv * LUMA_B, 0, 0,
    inv * LUMA_R, inv * LUMA_G, inv * LUMA_B + amount, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

function hueMatrix(degrees: number): ColorMatrix {
  const angle = (degrees * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    LUMA_R + cos * (1 - LUMA_R) + sin * -LUMA_R, LUMA_G + cos * -LUMA_G + sin * -LUMA_G, LUMA_B + cos * -LUMA_B + sin * (1 - LUMA_B), 0, 0,
    LUMA_R + cos * -LUMA_R + sin * 0.143, LUMA_G + cos * (1 - LUMA_G) + sin * 0.140, LUMA_B + cos * -LUMA_B + sin * -0.283, 0, 0,
    LUMA_R + cos * -LUMA_R + sin * -(1 - LUMA_R), LUMA_G + cos * -LUMA_G + sin * LUMA_G, LUMA_B + cos * (1 - LUMA_B) + sin * LUMA_B, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

/** Multiply two 4x5 color matrices (a ∘ b: apply b first, then a). */
function multiply(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out: ColorMatrix = Array.from({ length: 20 }, () => 0)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = 0
      for (let k = 0; k < 4; k++)
        sum += a[row * 5 + k]! * b[k * 5 + col]!
      if (col === 4)
        sum += a[row * 5 + 4]!
      out[row * 5 + col] = sum
    }
  }
  return out
}
