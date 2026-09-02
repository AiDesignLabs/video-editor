import { describe, expect, it } from 'vitest'
import { intersectsTimelineRenderWindow, resolveTimelineRenderWindow } from './virtualization'

describe('timeline virtualization', () => {
  it('adds half a visible screen of buffer on both sides', () => {
    expect(resolveTimelineRenderWindow({
      scrollLeft: 4000,
      viewportWidth: 1000,
      railWidth: 24,
      contentWidth: 10000,
    })).toEqual({ startPx: 3512, endPx: 5464 })
  })

  it('clamps the render window to the timeline content', () => {
    expect(resolveTimelineRenderWindow({
      scrollLeft: 0,
      viewportWidth: 1000,
      railWidth: 0,
      contentWidth: 1200,
    })).toEqual({ startPx: 0, endPx: 1200 })
  })

  it('includes items that touch either edge', () => {
    const window = { startPx: 100, endPx: 200 }
    expect(intersectsTimelineRenderWindow(50, 50, window)).toBe(true)
    expect(intersectsTimelineRenderWindow(200, 0, window)).toBe(true)
    expect(intersectsTimelineRenderWindow(49, 50, window)).toBe(false)
    expect(intersectsTimelineRenderWindow(201, 10, window)).toBe(false)
  })
})
