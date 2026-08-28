import type { IChromaKey, IMask } from '@video-editor/shared'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', async () => (await import('../../test/pixi-mock')).createPixiMock())

import { readFilterUniforms } from './effect-registry'
import {
  CHROMA_KEY_FRAGMENT,
  CHROMA_KEY_UNIFORM_GROUP,
  computeMaskUniforms,
  hexToRgb01,
  MASK_FRAGMENT,
  MASK_UNIFORM_GROUP,
  maskChromaStructuralKey,
} from './mask-chroma'
import { createSegmentFilterCache } from './segment-filter-cache'

const ctx = { timeMs: 0, sourceTimeMs: 0 }

const mask: IMask = { shape: 'ellipse', center: [0.5, 0.5], size: [0.4, 0.6], feather: 0.2, rotation: 90 }
const chromaKey: IChromaKey = { color: '#00ff00', similarity: 0.35, smoothness: 0.1, spillSuppress: 0.5 }

describe('hexToRgb01', () => {
  it('parses #rrggbb with and without the hash', () => {
    expect(hexToRgb01('#00ff00')).toEqual([0, 1, 0])
    expect(hexToRgb01('0000FF')).toEqual([0, 0, 1])
    expect(hexToRgb01(' #ffffff ')).toEqual([1, 1, 1])
  })

  it('reads each channel independently', () => {
    const [r, g, b] = hexToRgb01('#804020')
    expect(r).toBeCloseTo(128 / 255, 6)
    expect(g).toBeCloseTo(64 / 255, 6)
    expect(b).toBeCloseTo(32 / 255, 6)
  })

  it('falls back to black for malformed input', () => {
    expect(hexToRgb01('green')).toEqual([0, 0, 0])
    expect(hexToRgb01('#fff')).toEqual([0, 0, 0])
  })
})

describe('computeMaskUniforms', () => {
  it('maps the center into texture-coordinate space with a flipped y axis', () => {
    const uniforms = computeMaskUniforms({ shape: 'rect', center: [1, 1], size: [1, 1] })
    expect(uniforms.uCenter).toEqual([1, 0])
    expect(computeMaskUniforms({ shape: 'rect', center: [0, 0], size: [1, 1] }).uCenter).toEqual([0.5, 0.5])
  })

  it('halves the size, converts rotation to radians and defaults the optionals', () => {
    const uniforms = computeMaskUniforms({ shape: 'ellipse', center: [0, 0], size: [0.4, 0.6], rotation: 180 })
    expect(uniforms.uShape).toBe(1)
    expect(uniforms.uHalfSize[0]).toBeCloseTo(0.2, 6)
    expect(uniforms.uHalfSize[1]).toBeCloseTo(0.3, 6)
    expect(uniforms.uRotation).toBeCloseTo(Math.PI, 6)
    expect(uniforms.uFeather).toBe(0)
    expect(uniforms.uInverse).toBe(0)
  })

  it('never produces a zero half-extent', () => {
    expect(computeMaskUniforms({ shape: 'rect', center: [0, 0], size: [0, 0] }).uHalfSize).toEqual([1e-4, 1e-4])
  })
})

describe('maskChromaStructuralKey', () => {
  it('is empty when neither feature is enabled', () => {
    expect(maskChromaStructuralKey({})).toBe('')
  })

  it('includes the shape and inverse flag, but no numeric parameters', () => {
    expect(maskChromaStructuralKey({ mask })).toBe('mask:ellipse:0')
    expect(maskChromaStructuralKey({ mask: { ...mask, center: [0, 0], feather: 0.9 } })).toBe('mask:ellipse:0')
    expect(maskChromaStructuralKey({ mask: { ...mask, inverse: true } })).toBe('mask:ellipse:1')
    expect(maskChromaStructuralKey({ mask: { ...mask, shape: 'rect' } })).toBe('mask:rect:0')
  })

  it('reduces the chroma key to a presence flag', () => {
    expect(maskChromaStructuralKey({ chromaKey })).toBe('chroma:1')
    expect(maskChromaStructuralKey({ chromaKey: { ...chromaKey, similarity: 0.9 } })).toBe('chroma:1')
    expect(maskChromaStructuralKey({ mask, chromaKey })).toBe('chroma:1,mask:ellipse:0')
  })
})

describe('mask / chroma key fragments', () => {
  it('start with the highp precision qualifier', () => {
    // Pixi's default filter vertex shader is highp; a mismatch fails to link.
    expect(MASK_FRAGMENT.trimStart().startsWith('precision highp float;')).toBe(true)
    expect(CHROMA_KEY_FRAGMENT.trimStart().startsWith('precision highp float;')).toBe(true)
  })
})

describe('segment filter cache: mask and chroma key', () => {
  it('places the chroma key first and the mask after the palette', () => {
    const cache = createSegmentFilterCache()
    const filters = cache.resolve('seg-1', undefined, undefined, ctx, undefined, { mask, chromaKey })
    const entry = cache.peek('seg-1')!

    expect(filters).toHaveLength(2)
    expect(filters[0]).toBe(entry.chromaKeyFilter)
    expect(filters[1]).toBe(entry.maskFilter)
  })

  it('seeds the uniforms from the protocol values', () => {
    const cache = createSegmentFilterCache()
    const filters = cache.resolve('seg-1', undefined, undefined, ctx, undefined, { mask, chromaKey })

    expect(readFilterUniforms(filters[0]!, CHROMA_KEY_UNIFORM_GROUP)).toEqual({
      uKeyColor: [0, 1, 0],
      uSimilarity: 0.35,
      uSmoothness: 0.1,
      uSpillSuppress: 0.5,
    })
    expect(readFilterUniforms(filters[1]!, MASK_UNIFORM_GROUP)).toMatchObject({
      uShape: 1,
      uCenter: [0.75, 0.25],
      uFeather: 0.2,
      uInverse: 0,
    })
  })

  it('animating numeric params updates uniforms without rebuilding', () => {
    const cache = createSegmentFilterCache()
    const first = cache.resolve('seg-1', undefined, undefined, ctx, undefined, { mask, chromaKey })
    const chromaInstance = first[0]
    const maskInstance = first[1]

    const second = cache.resolve('seg-1', undefined, undefined, ctx, undefined, {
      mask: { ...mask, center: [0, 0], feather: 0.5, rotation: 0 },
      chromaKey: { ...chromaKey, similarity: 0.8 },
    })

    expect(second[0]).toBe(chromaInstance)
    expect(second[1]).toBe(maskInstance)
    expect(readFilterUniforms(chromaInstance!, CHROMA_KEY_UNIFORM_GROUP)).toMatchObject({ uSimilarity: 0.8 })
    expect(readFilterUniforms(maskInstance!, MASK_UNIFORM_GROUP)).toMatchObject({
      uCenter: [0.5, 0.5],
      uFeather: 0.5,
      uRotation: 0,
    })
  })

  it('changing the shape or the inverse flag rebuilds the chain', () => {
    const cache = createSegmentFilterCache()
    const first = cache.resolve('seg-1', undefined, undefined, ctx, undefined, { mask })
    const instance = first[0]

    const rebuilt = cache.resolve('seg-1', undefined, undefined, ctx, undefined, { mask: { ...mask, shape: 'rect' } })
    expect(rebuilt[0]).not.toBe(instance)
    expect(readFilterUniforms(rebuilt[0]!, MASK_UNIFORM_GROUP)).toMatchObject({ uShape: 0 })

    const inversed = cache.resolve('seg-1', undefined, undefined, ctx, undefined, { mask: { ...mask, shape: 'rect', inverse: true } })
    expect(inversed[0]).not.toBe(rebuilt[0])
    expect(readFilterUniforms(inversed[0]!, MASK_UNIFORM_GROUP)).toMatchObject({ uInverse: 1 })
  })

  it('contributes nothing when neither field is present', () => {
    const cache = createSegmentFilterCache()
    expect(cache.resolve('seg-1', undefined, undefined, ctx, undefined, {})).toEqual([])
    expect(cache.peek('seg-1')?.maskFilter).toBeUndefined()
    expect(cache.peek('seg-1')?.chromaKeyFilter).toBeUndefined()
  })

  it('disposes the filters when the segment leaves the frame', () => {
    const cache = createSegmentFilterCache()
    const filters = cache.resolve('seg-1', undefined, undefined, ctx, undefined, { mask, chromaKey })
    cache.evictInactive(new Set())
    for (const filter of filters)
      expect((filter as unknown as { destroyed: boolean }).destroyed).toBe(true)
  })
})
