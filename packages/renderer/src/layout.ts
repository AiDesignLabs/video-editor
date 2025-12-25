import type { IFillMode, SegmentUnion } from '@video-editor/shared'

export interface SegmentLayout {
  width: number
  height: number
  centerX: number
  centerY: number
  rotationRad: number
}

export function resolveFillSize(
  mode: IFillMode | undefined,
  sourceWidth: number,
  sourceHeight: number,
  stageWidth: number,
  stageHeight: number,
) {
  const safeSourceWidth = sourceWidth || stageWidth
  const safeSourceHeight = sourceHeight || stageHeight
  if (!safeSourceWidth || !safeSourceHeight)
    return { width: stageWidth, height: stageHeight }

  const sourceRatio = safeSourceWidth / safeSourceHeight
  const stageRatio = stageWidth / stageHeight

  switch (mode) {
    case 'none':
      return { width: safeSourceWidth, height: safeSourceHeight }
    case 'cover':
      if (sourceRatio > stageRatio)
        return { width: stageHeight * sourceRatio, height: stageHeight }
      return { width: stageWidth, height: stageWidth / sourceRatio }
    case 'stretch':
      return { width: stageWidth, height: stageHeight }
    case 'contain':
    default:
      if (sourceRatio > stageRatio)
        return { width: stageWidth, height: stageWidth / sourceRatio }
      return { width: stageHeight * sourceRatio, height: stageHeight }
  }
}

export function computeSegmentLayout(
  segment: SegmentUnion,
  stageWidth: number,
  stageHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): SegmentLayout {
  const fillMode = 'fillMode' in segment ? segment.fillMode : undefined
  const { width, height } = resolveFillSize(
    fillMode,
    sourceWidth,
    sourceHeight,
    stageWidth,
    stageHeight,
  )

  const transform = 'transform' in segment ? segment.transform : undefined
  const [px, py] = transform?.position ?? [0, 0]
  const [sx, sy] = transform?.scale ?? [1, 1]
  const rotation = transform?.rotation?.[2] ?? 0

  const finalWidth = width * sx
  const finalHeight = height * sy
  const centerX = stageWidth / 2 + (px * stageWidth) / 2
  const centerY = stageHeight / 2 - (py * stageHeight) / 2

  return {
    width: finalWidth,
    height: finalHeight,
    centerX,
    centerY,
    rotationRad: (rotation / 180) * Math.PI,
  }
}
