import type { VisualTrackFilterParam } from './types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class Filter {}
  class BlurFilter extends Filter {}
  class ColorMatrixFilter extends Filter {
    grayscale() {}
    sepia() {}
    negative() {}
    vintage() {}
    contrast() {}
    brightness() {}
    saturate() {}
    hue() {}
  }
  return { BlurFilter, ColorMatrixFilter, Filter }
})

import { getEffectDefinition, registerEffect } from './effect-registry'
import { createPixiFiltersFromVisualEffects } from './pixi-effects'

function filterParam(patch: Partial<VisualTrackFilterParam>): VisualTrackFilterParam {
  return {
    segmentType: 'filter',
    segmentId: 'seg-1',
    filterId: 'unknown-id',
    name: 'unknown',
    intensity: 1,
    ...patch,
  }
}

describe('effect registry', () => {
  it('resolves built-in definitions by canonical id', () => {
    expect(getEffectDefinition(filterParam({ filterId: 'grayscale' }))).toBeDefined()
    expect(getEffectDefinition(filterParam({ filterId: 'blur' }))).toBeDefined()
    expect(getEffectDefinition(filterParam({ filterId: 'nope' }))).toBeUndefined()
  })

  it('prefers registered definitions over legacy name matching', () => {
    const marker = { marker: true }
    registerEffect({
      id: 'custom-test-effect',
      label: 'Custom',
      build: () => [marker as never],
    })
    const filters = createPixiFiltersFromVisualEffects([
      filterParam({ filterId: 'custom-test-effect', name: 'blur' }),
    ])
    expect(filters).toEqual([marker])
  })

  it('falls back to legacy name-substring matching for unknown ids', () => {
    const filters = createPixiFiltersFromVisualEffects([
      filterParam({ filterId: 'not-registered', name: '梦幻模糊 blur' }),
    ])
    expect(filters).toHaveLength(1)
  })

  it('unknown effect names resolve to no filters without throwing', () => {
    const filters = createPixiFiltersFromVisualEffects([
      { segmentType: 'effect', segmentId: 's', effectId: 'mystery', name: '未知特效' },
    ])
    expect(filters).toHaveLength(0)
  })
})
