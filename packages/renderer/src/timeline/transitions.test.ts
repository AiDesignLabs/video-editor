import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', async () => (await import('../../test/pixi-mock')).createPixiMock())

import { readFilterUniforms } from './effect-registry'
import { createSegmentFilterCache } from './segment-filter-cache'
import { getTransitionDefinition, TRANSITION_UNIFORM_GROUP } from './transition-registry'
import { BUILT_IN_TRANSITIONS } from './transitions'

describe('built-in transitions', () => {
  it('registers every built-in under its id and label', () => {
    for (const definition of BUILT_IN_TRANSITIONS) {
      expect(getTransitionDefinition(definition.id)).toBe(definition)
      expect(getTransitionDefinition(definition.label.toUpperCase())).toBe(definition)
    }
    expect(getTransitionDefinition('crossfade')?.label).toBe('Crossfade')
  })

  it('every fragment starts with the highp precision qualifier', () => {
    // Pixi's default filter vertex shader is highp; a mismatch fails to link.
    for (const definition of BUILT_IN_TRANSITIONS)
      expect(definition.fragment?.trimStart().startsWith('precision highp float;')).toBe(true)
  })

  it('builds filters seeded with the role and the definition uniforms', () => {
    const wipe = getTransitionDefinition('wipe-left')!
    const cache = createSegmentFilterCache()
    const filters = cache.resolve('seg-1', undefined, undefined, { timeMs: 0, sourceTimeMs: 0 }, {
      role: 'to',
      progress: 0.25,
      transitionId: 'wipe-left',
    })

    expect(filters).toHaveLength(1)
    expect(cache.peek('seg-1')?.transitionDefinition).toBe(wipe)
    expect(readFilterUniforms(filters[0]!, TRANSITION_UNIFORM_GROUP)).toEqual({
      uProgress: 0.25,
      uRole: 1,
      uDirection: [-1, 0],
    })
  })

  it('advancing progress updates the uniform without rebuilding the filter', () => {
    const cache = createSegmentFilterCache()
    const ctx = { timeMs: 0, sourceTimeMs: 0 }
    const first = cache.resolve('seg-1', undefined, undefined, ctx, {
      role: 'from',
      progress: 0.1,
      transitionName: 'Crossfade',
    })
    const instance = first[0]
    const second = cache.resolve('seg-1', undefined, undefined, ctx, {
      role: 'from',
      progress: 0.9,
      transitionName: 'Crossfade',
    })

    expect(second[0]).toBe(instance)
    expect(readFilterUniforms(instance!, TRANSITION_UNIFORM_GROUP)).toMatchObject({ uProgress: 0.9, uRole: 0 })
  })

  it('switching role rebuilds the chain (structural key includes the role)', () => {
    const cache = createSegmentFilterCache()
    const ctx = { timeMs: 0, sourceTimeMs: 0 }
    const asFrom = cache.resolve('seg-1', undefined, undefined, ctx, { role: 'from', progress: 0.5, transitionId: 'zoom' })
    const fromInstance = asFrom[0]
    const asTo = cache.resolve('seg-1', undefined, undefined, ctx, { role: 'to', progress: 0.5, transitionId: 'zoom' })

    expect(asTo[0]).not.toBe(fromInstance)
    expect(readFilterUniforms(asTo[0]!, TRANSITION_UNIFORM_GROUP)).toMatchObject({ uRole: 1 })
  })

  it('contributes no filters when the transition does not resolve', () => {
    const cache = createSegmentFilterCache()
    const filters = cache.resolve('seg-1', undefined, undefined, { timeMs: 0, sourceTimeMs: 0 }, {
      role: 'to',
      progress: 0.5,
      transitionName: '未知转场',
    })
    expect(filters).toEqual([])
    expect(cache.peek('seg-1')?.transitionFilters).toBeUndefined()
  })
})
