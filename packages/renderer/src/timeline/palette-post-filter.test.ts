import type { IPalette } from '@video-editor/shared'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', async () => (await import('../../test/pixi-mock')).createPixiMock())

import { MOCK_DEFAULT_FILTER_VERT, MockFilter } from '../../test/pixi-mock'
import {
  createPalettePostFilter,
  PALETTE_NEUTRAL,
  PALETTE_POST_FRAGMENT,
  updatePalettePostFilter,
} from './palette-filter'
import { createSegmentFilterCache } from './segment-filter-cache'

function palette(patch: Partial<IPalette>): IPalette {
  return { ...PALETTE_NEUTRAL, ...patch }
}

describe('palette post filter', () => {
  it('builds a WebGL-only filter seeded with the palette uniforms', () => {
    const filter = createPalettePostFilter(palette({ vignette: 0.4, grain: 0.2 })) as unknown as MockFilter
    expect(filter.glProgram).toEqual({ vertex: MOCK_DEFAULT_FILTER_VERT, fragment: PALETTE_POST_FRAGMENT })
    expect(filter.resources.uPalettePost!.uniforms).toEqual({
      uSharpness: 0,
      uVignette: 0.4,
      uGrain: 0.2,
      uTime: 0,
    })
  })

  it('pushes new values (including time) into an existing filter', () => {
    const filter = createPalettePostFilter(palette({ grain: 0.2 }))
    updatePalettePostFilter(filter, palette({ sharpness: -0.5, vignette: 1, grain: 0.9 }), 2.5)
    expect((filter as unknown as MockFilter).resources.uPalettePost!.uniforms).toEqual({
      uSharpness: -0.5,
      uVignette: 1,
      uGrain: 0.9,
      uTime: 2.5,
    })
  })

  it('is appended after the palette color matrix and reused across frames', () => {
    const cache = createSegmentFilterCache()
    const first = cache.resolve('seg-1', undefined, palette({ brightness: 0.5, vignette: 0.5 }), {
      timeMs: 1000,
      sourceTimeMs: 0,
    })
    expect(first).toHaveLength(2)
    const post = first[1] as unknown as MockFilter
    expect(post.resources.uPalettePost!.uniforms.uTime).toBe(1)

    const second = cache.resolve('seg-1', undefined, palette({ brightness: 0.9, vignette: 0.8 }), {
      timeMs: 2500,
      sourceTimeMs: 0,
    })
    expect(second[1]).toBe(first[1])
    expect(post.destroyed).toBe(false)
    expect(post.resources.uPalettePost!.uniforms).toMatchObject({ uVignette: 0.8, uTime: 2.5 })
  })

  it('omits the post filter when only matrix fields are active', () => {
    const cache = createSegmentFilterCache()
    const filters = cache.resolve('seg-2', undefined, palette({ brightness: 0.5, fade: 0.4 }), {
      timeMs: 0,
      sourceTimeMs: 0,
    })
    expect(filters).toHaveLength(1)
  })
})
