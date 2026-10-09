import { describe, expect, it } from 'vitest'
import { placePresetPreview } from '../../../../playground/src/preset-preview-position'

describe('preview card placement', () => {
  it('puts a right sidebar preview outside the whole picker', () => {
    const picker = { left: 960, right: 1264, top: 60, bottom: 640 }
    const card = placePresetPreview(picker, { left: 1130, right: 1250, top: 450, bottom: 482 }, { width: 1280, height: 720 })!
    expect(card.left + card.width).toBeLessThan(picker.left)
    expect(card.top).toBeGreaterThanOrEqual(8)
  })
  it('uses the other side for a left sidebar', () => {
    const picker = { left: 8, right: 312, top: 40, bottom: 600 }
    const card = placePresetPreview(picker, picker, { width: 1280, height: 720 })!
    expect(card.left).toBeGreaterThan(picker.right)
  })
  it('keeps the active item clear on a narrow viewport', () => {
    const anchor = { left: 100, right: 250, top: 400, bottom: 432 }
    const card = placePresetPreview({ left: 8, right: 352, top: 40, bottom: 620 }, anchor, { width: 360, height: 640 })!
    expect(card.top + card.width * 9 / 16 + 44).toBeLessThan(anchor.top)
    expect(card.left + card.width).toBeLessThanOrEqual(352)
  })
})
