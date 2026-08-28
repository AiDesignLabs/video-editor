import type { Filter } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', async () => (await import('../../test/pixi-mock')).createPixiMock())

import { MOCK_DEFAULT_FILTER_VERT, MockFilter } from '../../test/pixi-mock'
import { readFilterUniforms } from './effect-registry'
import {
  buildTransitionFilters,
  getTransitionDefinition,
  listTransitionDefinitions,
  registerTransition,
  TRANSITION_UNIFORM_GROUP,
  transitionStructuralKey,
  unregisterTransition,
  updateTransitionFilters,
} from './transition-registry'

const FRAGMENT = `precision highp float;\nvoid main(void) {}\n`

describe('transition registry', () => {
  it('resolves by exact id, then case-insensitively by id or label', () => {
    registerTransition({ id: 'reg-test-dissolve', label: 'Soft Dissolve', fragment: FRAGMENT })

    expect(getTransitionDefinition('reg-test-dissolve')?.id).toBe('reg-test-dissolve')
    expect(getTransitionDefinition('REG-TEST-DISSOLVE')?.id).toBe('reg-test-dissolve')
    expect(getTransitionDefinition('soft dissolve')?.id).toBe('reg-test-dissolve')
    expect(getTransitionDefinition('  Soft Dissolve  ')?.id).toBe('reg-test-dissolve')
    expect(getTransitionDefinition('nope')).toBeUndefined()
    expect(getTransitionDefinition(undefined)).toBeUndefined()
    expect(getTransitionDefinition('')).toBeUndefined()

    expect(listTransitionDefinitions().some(def => def.id === 'reg-test-dissolve')).toBe(true)
    expect(unregisterTransition('reg-test-dissolve')).toBe(true)
    expect(getTransitionDefinition('reg-test-dissolve')).toBeUndefined()
  })

  it('rejects definitions with neither fragment nor build', () => {
    expect(() => registerTransition({ id: 'bad-transition', label: 'Bad' })).toThrow(/fragment/)
  })

  it('builds a shader filter carrying uProgress/uRole plus author uniforms', () => {
    const definition = {
      id: 'reg-test-shader',
      label: 'Shader',
      fragment: FRAGMENT,
      uniforms: { uDirection: { value: [1, 0], type: 'vec2<f32>' } },
    }

    const filters = buildTransitionFilters(definition, 'to')
    expect(filters).toHaveLength(1)
    const filter = filters[0] as unknown as MockFilter
    expect(filter.glProgram?.vertex).toBe(MOCK_DEFAULT_FILTER_VERT)
    expect(filter.glProgram?.fragment).toBe(FRAGMENT)

    const uniforms = readFilterUniforms(filters[0]!, TRANSITION_UNIFORM_GROUP)
    expect(uniforms).toEqual({ uProgress: 0, uRole: 1, uDirection: [1, 0] })
  })

  it('default update writes uProgress and uRole, clamped', () => {
    const definition = { id: 'reg-test-update', label: 'Update', fragment: FRAGMENT }
    const filters = buildTransitionFilters(definition, 'from')

    updateTransitionFilters(definition, filters, { timeMs: 100, progress: 0.25, role: 'from' })
    expect(readFilterUniforms(filters[0]!, TRANSITION_UNIFORM_GROUP)).toMatchObject({ uProgress: 0.25, uRole: 0 })

    updateTransitionFilters(definition, filters, { timeMs: 200, progress: 4, role: 'to' })
    expect(readFilterUniforms(filters[0]!, TRANSITION_UNIFORM_GROUP)).toMatchObject({ uProgress: 1, uRole: 1 })

    updateTransitionFilters(definition, filters, { timeMs: 300, progress: Number.NaN, role: 'to' })
    expect(readFilterUniforms(filters[0]!, TRANSITION_UNIFORM_GROUP)).toMatchObject({ uProgress: 0 })
  })

  it('an author update replaces the default entirely', () => {
    const update = vi.fn()
    const definition = { id: 'reg-test-custom', label: 'Custom', fragment: FRAGMENT, update }
    const filters = buildTransitionFilters(definition, 'to')

    updateTransitionFilters(definition, filters, { timeMs: 0, progress: 0.5, role: 'to' })
    expect(update).toHaveBeenCalledTimes(1)
    // Default uniforms untouched because the author update took over.
    expect(readFilterUniforms(filters[0]!, TRANSITION_UNIFORM_GROUP)).toMatchObject({ uProgress: 0 })
  })

  it('build escape hatch returns author-allocated filters', () => {
    const marker = { marker: true } as unknown as Filter
    const definition = { id: 'reg-test-build', label: 'Build', build: () => [marker] }
    expect(buildTransitionFilters(definition, 'from')).toEqual([marker])
  })

  it('structural key covers id and role', () => {
    const definition = { id: 'reg-test-key', label: 'Key', fragment: FRAGMENT }
    expect(transitionStructuralKey(definition, 'from')).toBe('transition:reg-test-key:from')
    expect(transitionStructuralKey(definition, 'to')).toBe('transition:reg-test-key:to')
  })
})
