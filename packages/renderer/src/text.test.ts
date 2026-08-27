import { describe, expect, it, vi } from 'vitest'

const { renderCalls } = vi.hoisted(() => ({
  renderCalls: [] as Array<{ runs: Array<{ content: string, cssText: string }>, scale?: number }>,
}))

vi.mock('./text-bitmap', () => ({
  renderTextRunsToImageBitmap: vi.fn(async (runs: Array<{ content: string, cssText: string }>, scale?: number) => {
    renderCalls.push({ runs, scale })
    return {
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      width: 100,
      height: 40,
      scale: scale ?? 2,
    }
  }),
}))

import { buildTextCss, buildTextRuns, clearTextBitmapCache, renderTextBitmap } from './text'

describe('renderTextBitmap cache', () => {
  it('caches per runs+scale and reuses entries', async () => {
    clearTextBitmapCache()
    renderCalls.length = 0

    const runs = [{ content: 'hello', cssText: 'font-size: 32px' }]
    const a = await renderTextBitmap(runs, 2)
    const b = await renderTextBitmap(runs, 2)
    expect(b).toBe(a)
    expect(renderCalls).toHaveLength(1)

    // A different raster scale is a distinct cache entry.
    const c = await renderTextBitmap(runs, 4)
    expect(c).not.toBe(a)
    expect(renderCalls).toHaveLength(2)
    expect(renderCalls[1]?.scale).toBe(4)

    // Different runs miss as before.
    await renderTextBitmap([{ content: 'world', cssText: 'font-size: 32px' }], 2)
    expect(renderCalls).toHaveLength(3)

    // Multi-line runs are keyed by every line's style.
    await renderTextBitmap([
      { content: 'hello', cssText: 'font-size: 32px' },
      { content: 'world', cssText: 'font-size: 16px; color: red' },
    ], 2)
    expect(renderCalls).toHaveLength(4)
    expect(renderCalls[3]?.runs).toHaveLength(2)
  })
})

describe('buildTextRuns', () => {
  it('produces one styled run per text item, skipping empty lines', () => {
    const runs = buildTextRuns([
      { content: 'line one', fontSize: 20 },
      { content: '' },
      { content: 'line two', fill: '#ff0000' },
    ])
    expect(runs).toHaveLength(2)
    expect(runs[0]?.content).toBe('line one')
    expect(runs[0]?.cssText).toContain('font-size: 20px')
    expect(runs[1]?.cssText).toContain('color: #ff0000')
  })
})

describe('buildTextCss opacity sub-fields', () => {
  it('applies stroke, background and drop-shadow opacity via color-mix', () => {
    const css = buildTextCss({
      content: 'x',
      stroke: { color: '#000000', width: 2, opacity: 0.5 },
      background: { color: '#00ff00', opacity: 0.25 },
      dropShadow: { color: '#0000ff', opacity: 0.75, distance: 4, angle: 0, blur: 2 },
    })
    expect(css).toContain('color-mix(in srgb, #000000 50%, transparent)')
    expect(css).toContain('color-mix(in srgb, #00ff00 25%, transparent)')
    expect(css).toContain('color-mix(in srgb, #0000ff 75%, transparent)')
  })

  it('keeps raw colors when opacity is absent or full', () => {
    const css = buildTextCss({
      content: 'x',
      background: { color: '#123456' },
      stroke: { color: '#654321', width: 1, opacity: 1 },
    })
    expect(css).toContain('background: #123456')
    expect(css).toContain('-webkit-text-stroke: 1px #654321')
  })
})
