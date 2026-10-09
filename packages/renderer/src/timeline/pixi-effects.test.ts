import { describe, expect, it, vi } from 'vitest'
import { listEffectDefinitions, listFilterDefinitions, listVisualEffectDefinitions, readFilterUniforms } from './effect-registry'
import { createPixiFiltersFromVisualEffects } from './pixi-effects'

vi.mock('pixi.js', async () => (await import('../../test/pixi-mock')).createPixiMock())

describe('createPixiFiltersFromVisualEffects', () => {
  it('ships a broad built-in catalog with concrete implementations', () => {
    const definitions = listEffectDefinitions()
    expect(definitions.length).toBeGreaterThanOrEqual(20)
    expect(definitions.map(definition => definition.id)).toEqual(expect.arrayContaining([
      'glow',
      'chromatic-aberration',
      'pixelate',
      'film-grain',
      'glitch',
      'bloom',
      'crt',
      'shockwave',
    ]))
    expect(definitions.every(definition => definition.fragment || definition.build)).toBe(true)
    expect(listFilterDefinitions().length).toBeGreaterThan(0)
    expect(listVisualEffectDefinitions().length).toBeGreaterThan(0)
  })

  it('maps grayscale filter config to a pixi filter', () => {
    const filters = createPixiFiltersFromVisualEffects([
      {
        segmentType: 'filter',
        segmentId: 'flt-1',
        filterId: 'grayscale',
        name: 'grayscale',
        intensity: 0.7,
      },
    ])
    expect(filters.length).toBe(1)
  })

  it('maps blur effect config to a pixi filter', () => {
    const filters = createPixiFiltersFromVisualEffects([
      {
        segmentType: 'effect',
        segmentId: 'fx-1',
        effectId: 'gaussian-blur',
        name: 'Gaussian Blur',
      },
    ])
    expect(filters.length).toBe(1)
  })

  it('seeds shader intensity in the direct convenience API', () => {
    const filters = createPixiFiltersFromVisualEffects([
      {
        segmentType: 'filter',
        segmentId: 'flt-shader',
        filterId: 'sharpen',
        name: 'Sharpen',
        intensity: 0.25,
      },
    ])
    expect(readFilterUniforms(filters[0]!)?.uAmount).toBe(0.25)
  })

  it('returns empty list for unknown effects', () => {
    const filters = createPixiFiltersFromVisualEffects([
      {
        segmentType: 'effect',
        segmentId: 'fx-2',
        effectId: 'unknown',
        name: 'Unknown',
      },
    ])
    expect(filters.length).toBe(0)
  })
})
