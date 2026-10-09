import { describe, expect, it } from 'vitest'
import { CUSTOM_EFFECT_SHADERS, CUSTOM_TRANSITION_SHADERS } from './catalog'

function expectFragmentSource(source: string) {
  expect(source.trimStart().startsWith('precision highp float;')).toBe(true)
  expect(source).toContain('void main')
  expect(source.match(/\{/g)?.length).toBe(source.match(/\}/g)?.length)
}

describe('custom shader sources', () => {
  it('keeps every effect shader as a standalone highp fragment', () => {
    for (const source of Object.values(CUSTOM_EFFECT_SHADERS))
      expectFragmentSource(source)
  })

  it('keeps every transition shader as a standalone highp fragment', () => {
    for (const source of Object.values(CUSTOM_TRANSITION_SHADERS))
      expectFragmentSource(source)
  })
})
