/**
 * Rasterize styled text into an ImageBitmap via an SVG <foreignObject>,
 * so the full CSS text stack (stroke, shadow, letter-spacing, ...) applies.
 *
 * The SVG must be loaded through a data: URL — Chromium taints ImageBitmaps
 * derived from blob: URL SVGs that contain <foreignObject>, which would make
 * WebGL texture uploads throw a SecurityError.
 */
export interface RenderedTextBitmap {
  bitmap: ImageBitmap
  /** CSS-pixel size; the bitmap itself is `scale`× larger for crisp rendering. */
  width: number
  height: number
  scale: number
}

export function resolveTextRasterScale() {
  const dpr = globalThis.devicePixelRatio || 1
  return Math.min(4, Math.max(2, Math.ceil(dpr)))
}

const MAX_TEXT_RASTER_DIMENSION = 8192

export async function renderTextToImageBitmap(
  content: string,
  cssText: string,
  scale: number = resolveTextRasterScale(),
): Promise<RenderedTextBitmap> {
  await document.fonts.ready

  const { width, height } = measureText(content, cssText)
  // Stay under browser canvas limits for very long text or large scales.
  const maxScale = MAX_TEXT_RASTER_DIMENSION / Math.max(width, height)
  scale = Math.max(1, Math.min(scale, maxScale))
  const style = `display: inline-block; margin: 0; ${cssText}`
  // viewBox keeps the CSS-pixel layout while the raster is scale× larger.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">`
    + `<foreignObject width="${width}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXml(style)}">${escapeXml(content)}</div>`
    + `</foreignObject></svg>`

  const img = new Image(width * scale, height * scale)
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()

  const canvas = new OffscreenCanvas(width * scale, height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('renderTextToImageBitmap: 2d context unavailable')
  ctx.drawImage(img, 0, 0, width * scale, height * scale)
  const bitmap = await createImageBitmap(canvas)
  return { bitmap, width, height, scale }
}

/** Measure the CSS-pixel layout size of the given text without rasterizing. */
export function measureTextCss(content: string, cssText: string) {
  return measureText(content, cssText)
}

function measureText(content: string, cssText: string) {
  const el = document.createElement('div')
  el.style.cssText = `position: fixed; left: -9999px; top: -9999px; visibility: hidden; display: inline-block; margin: 0; ${cssText}`
  el.textContent = content
  document.body.appendChild(el)
  const rect = el.getBoundingClientRect()
  el.remove()
  return {
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
