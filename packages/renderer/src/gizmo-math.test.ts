import type { VisualBox } from './gizmo-math'
import { describe, expect, it } from 'vitest'
import {
  hitTestBoxes,
  isPointInBox,
  normalizeRotationDeg,
  positionFromCenter,
  scaleFromSize,
  snapRotationDeg,
  toBoxLocalPoint,
} from './gizmo-math'
import { computeSegmentLayout } from './layout'

function makeBox(partial: Partial<VisualBox> & { segmentId: string }): VisualBox {
  return {
    segmentType: 'frames',
    zOrder: 0,
    centerX: 0,
    centerY: 0,
    width: 100,
    height: 100,
    rotationRad: 0,
    baseWidth: 100,
    baseHeight: 100,
    hasTransformKeyframes: false,
    ...partial,
  }
}

describe('isPointInBox', () => {
  it('accepts points inside an axis-aligned box', () => {
    const box = makeBox({ segmentId: 'a', centerX: 100, centerY: 50, width: 40, height: 20 })
    expect(isPointInBox(box, 100, 50)).toBe(true)
    expect(isPointInBox(box, 119, 59)).toBe(true)
    expect(isPointInBox(box, 121, 50)).toBe(false)
    expect(isPointInBox(box, 100, 61)).toBe(false)
  })

  it('respects rotation', () => {
    const box = makeBox({ segmentId: 'a', width: 100, height: 10, rotationRad: Math.PI / 2 })
    // The long axis is now vertical.
    expect(isPointInBox(box, 0, 40)).toBe(true)
    expect(isPointInBox(box, 40, 0)).toBe(false)
  })
})

describe('toBoxLocalPoint', () => {
  it('undoes the box rotation', () => {
    const box = makeBox({ segmentId: 'a', centerX: 10, centerY: 10, rotationRad: Math.PI / 2 })
    const local = toBoxLocalPoint(box, 10, 20)
    expect(local.x).toBeCloseTo(10)
    expect(local.y).toBeCloseTo(0)
  })
})

describe('hitTestBoxes', () => {
  const bottom = makeBox({ segmentId: 'bottom', zOrder: 0, width: 200, height: 200 })
  const top = makeBox({ segmentId: 'top', zOrder: 1, width: 50, height: 50 })

  it('returns the top-most overlapping box', () => {
    expect(hitTestBoxes([bottom, top], 0, 0)?.segmentId).toBe('top')
    expect(hitTestBoxes([top, bottom], 0, 0)?.segmentId).toBe('top')
  })

  it('falls back to the lower box outside the top one', () => {
    expect(hitTestBoxes([bottom, top], 80, 0)?.segmentId).toBe('bottom')
  })

  it('returns undefined on empty space', () => {
    expect(hitTestBoxes([bottom, top], 500, 500)).toBeUndefined()
  })
})

describe('positionFromCenter', () => {
  it('inverts the forward center math', () => {
    expect(positionFromCenter(640, 360, 1280, 720)).toEqual({ px: 0, py: 0 })
    const stageW = 1280
    const stageH = 720
    const px = 0.25
    const py = -0.5
    const centerX = stageW / 2 + (px * stageW) / 2
    const centerY = stageH / 2 - (py * stageH) / 2
    const result = positionFromCenter(centerX, centerY, stageW, stageH)
    expect(result.px).toBeCloseTo(px)
    expect(result.py).toBeCloseTo(py)
  })

  it('clamps to [-1, 1]', () => {
    expect(positionFromCenter(-9999, 9999, 1280, 720)).toEqual({ px: -1, py: -1 })
    expect(positionFromCenter(9999, -9999, 1280, 720)).toEqual({ px: 1, py: 1 })
  })
})

describe('scaleFromSize', () => {
  it('divides by the base size', () => {
    expect(scaleFromSize(200, 50, 100, 100)).toEqual({ sx: 2, sy: 0.5 })
  })

  it('clamps into [0.01, 5]', () => {
    expect(scaleFromSize(0, 100000, 100, 100)).toEqual({ sx: 0.01, sy: 5 })
  })

  it('survives a zero base size', () => {
    expect(scaleFromSize(1, 1, 0, 0)).toEqual({ sx: 1, sy: 1 })
  })
})

describe('normalizeRotationDeg', () => {
  it('converts radians to a [0, 360) degree value', () => {
    expect(normalizeRotationDeg(0)).toBe(0)
    expect(normalizeRotationDeg(Math.PI)).toBeCloseTo(180)
    expect(normalizeRotationDeg(-Math.PI / 2)).toBeCloseTo(270)
    expect(normalizeRotationDeg(3 * Math.PI)).toBeCloseTo(180)
  })
})

describe('snapRotationDeg', () => {
  it('snaps to the nearest step', () => {
    expect(snapRotationDeg(17, 15)).toBe(15)
    expect(snapRotationDeg(23, 15)).toBe(30)
    expect(snapRotationDeg(-7, 15)).toBe(0)
    expect(snapRotationDeg(358, 15)).toBe(0)
  })
})

describe('round trip against computeSegmentLayout', () => {
  it('recovers position, scale and rotation', () => {
    const stageW = 1280
    const stageH = 720
    const segment = {
      id: 's1',
      segmentType: 'frames' as const,
      type: 'image' as const,
      format: 'img' as const,
      startTime: 0,
      endTime: 1000,
      url: 'a.png',
      fillMode: 'stretch' as const,
      transform: {
        position: [0.3, -0.2, 0] as [number, number, number],
        rotation: [0, 0, 42] as [number, number, number],
        scale: [1.5, 0.75, 1] as [number, number, number],
      },
    }
    const layout = computeSegmentLayout(segment, stageW, stageH, stageW, stageH)
    const position = positionFromCenter(layout.centerX, layout.centerY, stageW, stageH)
    const scale = scaleFromSize(layout.width, layout.height, stageW, stageH)
    expect(position.px).toBeCloseTo(0.3)
    expect(position.py).toBeCloseTo(-0.2)
    expect(scale.sx).toBeCloseTo(1.5)
    expect(scale.sy).toBeCloseTo(0.75)
    expect(normalizeRotationDeg(layout.rotationRad)).toBeCloseTo(42)
  })
})
