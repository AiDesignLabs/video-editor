import type { VisualTrackFilterParam } from './types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', async () => (await import('../../test/pixi-mock')).createPixiMock())

import { MOCK_DEFAULT_FILTER_VERT, MockBlurFilter, MockColorMatrixFilter, MockFilter } from '../../test/pixi-mock'
import { buildEffectFilters, getEffectDefinition, registerEffect, structuralKeyForEffect, unregisterEffect } from './effect-registry'
import { createPixiFiltersFromVisualEffects, resolveEffectDefinition } from './pixi-effects'
import { createSegmentFilterCache } from './segment-filter-cache'

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

  it('rejects definitions with neither fragment nor build', () => {
    expect(() => registerEffect({ id: 'bad-effect', label: 'Bad' })).toThrow(/fragment/)
  })
})

describe('glsl convenience path', () => {
  const FRAGMENT = 'void main(void) { finalColor = texture(uTexture, vTextureCoord); }'

  it('builds a WebGL-only filter from a fragment, with per-instance uniforms', () => {
    registerEffect({
      id: 'shader-test',
      label: 'Shader Test',
      fragment: FRAGMENT,
      uniforms: {
        uAmount: { value: 0.25, type: 'f32' },
        uOffset: { value: [1, 2], type: 'vec2<f32>' },
      },
      filterOptions: { padding: 4 },
      update: (filters, param) => {
        const uniforms = (filters[0] as unknown as MockFilter).resources.uEffect!.uniforms
        uniforms.uAmount = param.segmentType === 'filter' ? param.intensity : 1
      },
    })

    const definition = getEffectDefinition(filterParam({ filterId: 'shader-test' }))!
    const [a] = buildEffectFilters(definition, filterParam({ filterId: 'shader-test' })) as unknown as MockFilter[]
    const [b] = buildEffectFilters(definition, filterParam({ filterId: 'shader-test' })) as unknown as MockFilter[]

    expect(a!.glProgram).toEqual({ vertex: MOCK_DEFAULT_FILTER_VERT, fragment: FRAGMENT })
    expect(a!.options?.padding).toBe(4)
    expect(a!.resources.uEffect!.uniforms.uAmount).toBe(0.25)

    // Uniform bags are per instance; mutating one must not leak into the other
    // or back into the definition.
    a!.resources.uEffect!.uniforms.uAmount = 0.9
    expect(b!.resources.uEffect!.uniforms.uAmount).toBe(0.25)
    expect(definition.uniforms!.uAmount.value).toBe(0.25)
    expect(definition.uniforms!.uOffset.value).toEqual([1, 2])

    unregisterEffect('shader-test')
    expect(getEffectDefinition(filterParam({ filterId: 'shader-test' }))).toBeUndefined()
  })

  it('defaults structuralKey to the definition id', () => {
    const definition = getEffectDefinition(filterParam({ filterId: 'blur' }))!
    expect(structuralKeyForEffect(definition, filterParam({ filterId: 'blur', intensity: 0.1 }))).toBe('blur')
    expect(structuralKeyForEffect(definition, filterParam({ filterId: 'blur', intensity: 0.9 }))).toBe('blur')
  })
})

describe('segment filter cache update path', () => {
  it('updates a custom shader every frame without rebuilding it', () => {
    let builds = 0
    registerEffect({
      id: 'animated-shader',
      label: 'Animated',
      fragment: 'void main(void) { finalColor = texture(uTexture, vTextureCoord); }',
      uniforms: { uAmount: { value: 0, type: 'f32' }, uTime: { value: 0, type: 'f32' } },
      update: (filters, param, ctx) => {
        const uniforms = (filters[0] as unknown as MockFilter).resources.uEffect!.uniforms
        uniforms.uAmount = param.segmentType === 'filter' ? param.intensity : 1
        uniforms.uTime = ctx.timeMs / 1000
      },
    })
    const definition = getEffectDefinition(filterParam({ filterId: 'animated-shader' }))!
    const cache = createSegmentFilterCache({
      buildFilters: (def, param) => {
        builds++
        return buildEffectFilters(def, param)
      },
    })

    const frame1 = cache.resolve(
      'seg-1',
      [filterParam({ filterId: 'animated-shader', intensity: 0.2 })],
      undefined,
      { timeMs: 1000, sourceTimeMs: 0 },
    )
    const filter = frame1[0] as unknown as MockFilter
    expect(builds).toBe(1)
    expect(filter.resources.uEffect!.uniforms).toEqual({ uAmount: 0.2, uTime: 1 })

    const frame2 = cache.resolve(
      'seg-1',
      [filterParam({ filterId: 'animated-shader', intensity: 0.8 })],
      undefined,
      { timeMs: 2000, sourceTimeMs: 500 },
    )
    // Same instance, no rebuild, but the animated uniforms moved.
    expect(builds).toBe(1)
    expect(frame2[0]).toBe(filter)
    expect(filter.destroyed).toBe(false)
    expect(filter.resources.uEffect!.uniforms).toEqual({ uAmount: 0.8, uTime: 2 })

    // A different effect chain is a structural change: rebuild + dispose.
    cache.resolve('seg-1', [filterParam({ filterId: 'grayscale' })], undefined, { timeMs: 3000, sourceTimeMs: 0 })
    expect(builds).toBe(2)
    expect(filter.destroyed).toBe(true)
    expect(filter.destroyCalls).toEqual([undefined])

    cache.clear()
    unregisterEffect('animated-shader')
    expect(definition.id).toBe('animated-shader')
  })

  it('keeps built-in filters alive while their keyframed intensity animates', () => {
    const cache = createSegmentFilterCache()
    const blurParam = (intensity: number) => filterParam({ filterId: 'blur', intensity })

    const first = cache.resolve('seg-blur', [blurParam(0)], undefined, { timeMs: 0, sourceTimeMs: 0 })
    const blur = first[0] as unknown as MockBlurFilter
    expect(blur.strength).toBe(1)

    const second = cache.resolve('seg-blur', [blurParam(1)], undefined, { timeMs: 16, sourceTimeMs: 16 })
    expect(second[0]).toBe(blur)
    expect(blur.destroyed).toBe(false)
    expect(blur.strength).toBe(15)
  })

  it('re-applies color matrix presets in place, resetting first', () => {
    const cache = createSegmentFilterCache()
    const grayParam = (intensity: number) => filterParam({ filterId: 'grayscale', intensity })

    const first = cache.resolve('seg-gray', [grayParam(0.25)], undefined, { timeMs: 0, sourceTimeMs: 0 })
    const matrix = first[0] as unknown as MockColorMatrixFilter
    expect(matrix.calls.slice(-2)).toEqual([['reset', undefined], ['grayscale', 0.25]])

    cache.resolve('seg-gray', [grayParam(0.75)], undefined, { timeMs: 16, sourceTimeMs: 16 })
    expect(matrix.calls.slice(-2)).toEqual([['reset', undefined], ['grayscale', 0.75]])
  })

  it('routes legacy name matches through the same definitions', () => {
    const definition = resolveEffectDefinition(filterParam({ filterId: 'not-registered', name: '梦幻模糊 blur' }))
    expect(definition?.id).toBe('blur')
    expect(resolveEffectDefinition(filterParam({ filterId: 'nope', name: '???' }))?.id).toBe('legacy:desaturate')
  })

  it('evicts and disposes filters for segments that leave the plan', () => {
    const cache = createSegmentFilterCache()
    const filters = cache.resolve('seg-x', [filterParam({ filterId: 'sepia' })], undefined, { timeMs: 0, sourceTimeMs: 0 })
    expect(cache.size).toBe(1)
    cache.evictInactive(new Set(['seg-other']))
    expect(cache.size).toBe(0)
    expect((filters[0] as unknown as MockFilter).destroyed).toBe(true)
  })
})
