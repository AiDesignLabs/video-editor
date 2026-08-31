/**
 * Pinch-to-zoom maths.
 *
 * Browsers report a macOS trackpad pinch as a `wheel` event with `ctrlKey`
 * set, so the gesture arrives as a delta rather than a scale. Safari *also*
 * fires non-standard `gesturestart`/`gesturechange`/`gestureend` events that
 * carry an absolute `scale`, which has to be converted to a per-event factor.
 *
 * Constants match the shipped creatly implementation
 * (`preview-workspace/composables/useVideoTracksPlayback.ts`) so the packaged
 * behaviour feels identical to what users already have.
 */

export const PINCH_ZOOM_SENSITIVITY = 0.002
export const MAX_PINCH_DELTA_Y = 120

/**
 * Normalise a wheel delta to pixels.
 *
 * `deltaY` is only in pixels when `deltaMode` is `DOM_DELTA_PIXEL`; Firefox
 * commonly reports lines instead, which would otherwise read as a ~16x weaker
 * gesture.
 */
export function normalizeWheelDeltaY(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, viewportHeight = 800): number {
  if (event.deltaMode === 1 /* DOM_DELTA_LINE */)
    return event.deltaY * 16
  if (event.deltaMode === 2 /* DOM_DELTA_PAGE */)
    return event.deltaY * viewportHeight
  return event.deltaY
}

/**
 * Zoom multiplier for one pinch delta.
 *
 * Exponential so the gesture feels linear on a logarithmic zoom scale, and
 * clamped so a single high-momentum event cannot jump the whole range.
 * Pinching out (negative delta) returns > 1.
 */
export function pinchZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0)
    return 1

  const clamped = Math.min(MAX_PINCH_DELTA_Y, Math.max(-MAX_PINCH_DELTA_Y, deltaY))
  return Math.exp(-clamped * PINCH_ZOOM_SENSITIVITY)
}

/**
 * Per-event factor from Safari's absolute gesture scale.
 *
 * `event.scale` is cumulative for the whole gesture, so the incremental factor
 * is the ratio against the previously seen scale.
 */
export function gestureZoomFactor(scale: number | undefined, lastScale: number): number {
  const next = Number.isFinite(scale) && (scale as number) > 0 ? (scale as number) : 1
  if (!Number.isFinite(lastScale) || lastScale <= 0)
    return 1
  return next / lastScale
}

/** Normalises a possibly-missing/invalid gesture scale to a usable number. */
export function normalizeGestureScale(scale: number | undefined): number {
  return Number.isFinite(scale) && (scale as number) > 0 ? (scale as number) : 1
}
