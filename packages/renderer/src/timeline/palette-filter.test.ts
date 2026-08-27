import type { IPalette } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { computePaletteMatrix, PALETTE_NEUTRAL } from './palette-filter'

function palette(patch: Partial<IPalette>): IPalette {
  return { ...PALETTE_NEUTRAL, ...patch }
}

function applyMatrix(matrix: number[], rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb
  const out: number[] = []
  for (let row = 0; row < 3; row++) {
    out.push(
      matrix[row * 5]! * r
      + matrix[row * 5 + 1]! * g
      + matrix[row * 5 + 2]! * b
      + matrix[row * 5 + 4]!,
    )
  }
  return out as [number, number, number]
}

describe('computePaletteMatrix', () => {
  it('returns null for a neutral palette', () => {
    expect(computePaletteMatrix(PALETTE_NEUTRAL)).toBeNull()
  })

  it('warm temperature boosts red and reduces blue', () => {
    const matrix = computePaletteMatrix(palette({ temperature: 20000 }))!
    const [r, g, b] = applyMatrix(matrix, [0.5, 0.5, 0.5])
    expect(r).toBeGreaterThan(0.5)
    expect(g).toBeCloseTo(0.5, 6)
    expect(b).toBeLessThan(0.5)
  })

  it('cool temperature boosts blue', () => {
    const matrix = computePaletteMatrix(palette({ temperature: 3000 }))!
    const [r, , b] = applyMatrix(matrix, [0.5, 0.5, 0.5])
    expect(b).toBeGreaterThan(0.5)
    expect(r).toBeLessThan(0.5)
  })

  it('brightness scales all channels', () => {
    const matrix = computePaletteMatrix(palette({ brightness: 0.5 }))!
    const [r, g, b] = applyMatrix(matrix, [0.4, 0.4, 0.4])
    const expected = 0.4 * (1 + 0.5 * 0.6)
    expect(r).toBeCloseTo(expected, 6)
    expect(g).toBeCloseTo(expected, 6)
    expect(b).toBeCloseTo(expected, 6)
  })

  it('contrast pivots around mid-gray', () => {
    const matrix = computePaletteMatrix(palette({ contrast: 1 }))!
    const [mid] = applyMatrix(matrix, [0.5, 0.5, 0.5])
    expect(mid).toBeCloseTo(0.5, 6)
    const [dark] = applyMatrix(matrix, [0.2, 0.2, 0.2])
    expect(dark).toBeLessThan(0.2)
    const [bright] = applyMatrix(matrix, [0.8, 0.8, 0.8])
    expect(bright).toBeGreaterThan(0.8)
  })

  it('full desaturation converges channels to luma', () => {
    const matrix = computePaletteMatrix(palette({ saturation: -1 }))!
    const [r, g, b] = applyMatrix(matrix, [1, 0, 0])
    expect(r).toBeCloseTo(g, 6)
    expect(g).toBeCloseTo(b, 6)
    expect(r).toBeCloseTo(0.2126, 4)
  })

  it('shadow lifts dark values via constant offset', () => {
    const matrix = computePaletteMatrix(palette({ shadow: 1 }))!
    const [black] = applyMatrix(matrix, [0, 0, 0])
    expect(black).toBeCloseTo(0.08, 6)
  })

  it('composes multiple fields into one matrix', () => {
    const matrix = computePaletteMatrix(palette({ brightness: 0.5, saturation: -1 }))!
    const [r, g, b] = applyMatrix(matrix, [1, 0, 0])
    expect(r).toBeCloseTo(g, 6)
    expect(r).toBeCloseTo(0.2126 * 1.3, 4)
    expect(b).toBeCloseTo(r, 6)
  })
})
