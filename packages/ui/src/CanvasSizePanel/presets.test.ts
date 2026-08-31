import { describe, expect, it } from 'vitest'
import {
  CANVAS_SIZE_PRESETS,
  formatAspectRatio,
  matchPreset,
  orientationOf,
} from './presets'

describe('formatAspectRatio', () => {
  it('reduces common resolutions to their familiar ratio', () => {
    expect(formatAspectRatio(1920, 1080)).toBe('16:9')
    expect(formatAspectRatio(1080, 1920)).toBe('9:16')
    expect(formatAspectRatio(1080, 1080)).toBe('1:1')
    expect(formatAspectRatio(1440, 1080)).toBe('4:3')
    expect(formatAspectRatio(2560, 1080)).toBe('64:27')
  })

  it('falls back to a decimal when the reduced form is meaningless', () => {
    // 1001:1000 would technically be correct and tell the user nothing.
    expect(formatAspectRatio(1001, 1000)).toBe('1.00:1')
    expect(formatAspectRatio(1003, 500)).toBe('2.01:1')
  })

  it('returns a placeholder for degenerate input', () => {
    expect(formatAspectRatio(0, 1080)).toBe('—')
    expect(formatAspectRatio(1920, 0)).toBe('—')
    expect(formatAspectRatio(Number.NaN, 1080)).toBe('—')
    expect(formatAspectRatio(-1920, 1080)).toBe('—')
  })
})

describe('matchPreset', () => {
  it('matches on exact dimensions, not just ratio', () => {
    expect(matchPreset(1920, 1080)?.id).toBe('16-9')
    // Same 16:9 ratio, different resolution — not the preset.
    expect(matchPreset(1280, 720)).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(matchPreset(1234, 567)).toBeNull()
  })

  it('accepts a custom preset list', () => {
    const custom = [{ id: 'x', label: 'X', width: 100, height: 200 }]
    expect(matchPreset(100, 200, custom)?.id).toBe('x')
    expect(matchPreset(1920, 1080, custom)).toBeNull()
  })
})

describe('orientationOf', () => {
  it('classifies the three cases', () => {
    expect(orientationOf(1920, 1080)).toBe('landscape')
    expect(orientationOf(1080, 1920)).toBe('portrait')
    expect(orientationOf(1080, 1080)).toBe('square')
  })
})

describe('canvas size presets', () => {
  it('has unique ids', () => {
    const ids = CANVAS_SIZE_PRESETS.map(preset => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('labels agree with the dimensions they carry', () => {
    for (const preset of CANVAS_SIZE_PRESETS) {
      // 21:9 is the marketing name for 64:27; everything else should be exact.
      if (preset.id === '21-9')
        continue
      expect(formatAspectRatio(preset.width, preset.height)).toBe(preset.label)
    }
  })

  it('covers landscape, portrait and square', () => {
    const orientations = new Set(CANVAS_SIZE_PRESETS.map(p => orientationOf(p.width, p.height)))
    expect(orientations).toEqual(new Set(['landscape', 'portrait', 'square']))
  })
})
