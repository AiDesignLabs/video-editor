import { describe, expect, it, vi } from 'vitest'
vi.mock('pixi.js', async () => (await import('../../test/pixi-mock')).createPixiMock())
import { createPixiFiltersFromVisualEffects } from './pixi-effects'

describe('createPixiFiltersFromVisualEffects', () => {
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
