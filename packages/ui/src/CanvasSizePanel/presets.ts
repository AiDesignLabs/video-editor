/**
 * Canvas-size presets and the pure helpers behind the panel.
 *
 * Kept separate from the component so the ratio maths — the part that is easy
 * to get subtly wrong — is directly testable.
 */

export interface CanvasSizePreset {
  id: string
  label: string
  icon?: string
  width: number
  height: number
}

/** Landscape, portrait and square presets at the resolutions people actually ship. */
export const CANVAS_SIZE_PRESETS: CanvasSizePreset[] = [
  { id: '16-9', label: '16:9', icon: 'i-creatly-169', width: 1920, height: 1080 },
  { id: '9-16', label: '9:16', icon: 'i-creatly-916', width: 1080, height: 1920 },
  { id: '1-1', label: '1:1', icon: 'i-creatly-11', width: 1080, height: 1080 },
  { id: '4-3', label: '4:3', icon: 'i-creatly-43', width: 1440, height: 1080 },
  { id: '3-4', label: '3:4', icon: 'i-creatly-34', width: 1080, height: 1440 },
  { id: '3-2', label: '3:2', icon: 'i-creatly-32', width: 1620, height: 1080 },
  { id: '2-3', label: '2:3', icon: 'i-creatly-23', width: 1080, height: 1620 },
  // Labelled by its marketing name; the true reduced ratio is 64:27.
  { id: '21-9', label: '21:9', icon: 'i-creatly-219', width: 2560, height: 1080 },
]

/** Above this, a reduced ratio stops being something a person can read. */
const RATIO_TERM_LIMIT = 100

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

/**
 * Human-readable aspect ratio, e.g. `1920x1080` → `16:9`.
 *
 * The cap keeps legitimate cinematic ratios readable (2560x1080 really is
 * 64:27) while still rejecting reduced forms that tell the user nothing, like
 * 1001:1000 — those fall back to a decimal.
 */
export function formatAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return '—'

  const w = Math.round(width)
  const h = Math.round(height)
  const divisor = greatestCommonDivisor(w, h) || 1
  const ratioW = w / divisor
  const ratioH = h / divisor

  if (ratioW <= RATIO_TERM_LIMIT && ratioH <= RATIO_TERM_LIMIT)
    return `${ratioW}:${ratioH}`

  return `${(w / h).toFixed(2)}:1`
}

/** The preset matching an exact width/height, if any. */
export function matchPreset(
  width: number,
  height: number,
  presets: CanvasSizePreset[] = CANVAS_SIZE_PRESETS,
): CanvasSizePreset | null {
  return presets.find(preset => preset.width === width && preset.height === height) ?? null
}

/**
 * Orientation of a canvas, used to group the presets.
 *
 * Exact squares are their own case rather than being lumped with landscape.
 */
export function orientationOf(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  if (width === height)
    return 'square'
  return width > height ? 'landscape' : 'portrait'
}
