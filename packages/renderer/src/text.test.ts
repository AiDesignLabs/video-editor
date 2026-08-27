import { describe, expect, it, vi } from 'vitest'

const { renderCalls } = vi.hoisted(() => ({
  renderCalls: [] as Array<{ content: string, css: string, scale?: number }>,
}))

vi.mock('./text-bitmap', () => ({
  renderTextToImageBitmap: vi.fn(async (content: string, css: string, scale?: number) => {
    renderCalls.push({ content, css, scale })
    return {
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      width: 100,
      height: 40,
      scale: scale ?? 2,
    }
  }),
}))

import { clearTextBitmapCache, renderTextBitmap } from './text'

describe('renderTextBitmap cache', () => {
  it('caches per content+css+scale and reuses entries', async () => {
    clearTextBitmapCache()
    renderCalls.length = 0

    const a = await renderTextBitmap('hello', 'font-size: 32px', 2)
    const b = await renderTextBitmap('hello', 'font-size: 32px', 2)
    expect(b).toBe(a)
    expect(renderCalls).toHaveLength(1)

    // A different raster scale is a distinct cache entry.
    const c = await renderTextBitmap('hello', 'font-size: 32px', 4)
    expect(c).not.toBe(a)
    expect(renderCalls).toHaveLength(2)
    expect(renderCalls[1]?.scale).toBe(4)

    // Different content misses as before.
    await renderTextBitmap('world', 'font-size: 32px', 2)
    expect(renderCalls).toHaveLength(3)
  })
})
