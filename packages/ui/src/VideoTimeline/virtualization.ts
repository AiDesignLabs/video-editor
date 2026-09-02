export interface TimelineRenderWindow {
  startPx: number
  endPx: number
}

interface ResolveTimelineRenderWindowOptions {
  scrollLeft: number
  viewportWidth: number
  railWidth: number
  contentWidth: number
  bufferRatio?: number
}

export const TIMELINE_RENDER_BUFFER_RATIO = 0.5

/** Visible timeline coordinates plus a buffer on both sides. */
export function resolveTimelineRenderWindow({
  scrollLeft,
  viewportWidth,
  railWidth,
  contentWidth,
  bufferRatio = TIMELINE_RENDER_BUFFER_RATIO,
}: ResolveTimelineRenderWindowOptions): TimelineRenderWindow {
  const visibleWidth = Math.max(viewportWidth - railWidth, 0)
  const buffer = visibleWidth * Math.max(bufferRatio, 0)
  const safeContentWidth = Math.max(contentWidth, 0)

  return {
    startPx: Math.max(0, scrollLeft - buffer),
    endPx: Math.min(safeContentWidth, scrollLeft + visibleWidth + buffer),
  }
}

export function intersectsTimelineRenderWindow(
  left: number,
  width: number,
  renderWindow: TimelineRenderWindow,
) {
  const right = left + Math.max(width, 0)
  return right >= renderWindow.startPx && left <= renderWindow.endPx
}
