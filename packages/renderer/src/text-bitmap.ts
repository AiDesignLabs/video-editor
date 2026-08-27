/**
 * Rasterize styled text into an ImageBitmap via an SVG <foreignObject>,
 * so the full CSS text stack (stroke, shadow, letter-spacing, ...) applies.
 *
 * The SVG must be loaded through a data: URL — Chromium taints ImageBitmaps
 * derived from blob: URL SVGs that contain <foreignObject>, which would make
 * WebGL texture uploads throw a SecurityError.
 */
export async function renderTextToImageBitmap(content: string, cssText: string): Promise<ImageBitmap> {
  await document.fonts.ready

  const { width, height } = measureText(content, cssText)
  const style = `display: inline-block; margin: 0; ${cssText}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="${escapeXml(style)}">${escapeXml(content)}</div>`
    + `</foreignObject></svg>`

  const img = new Image(width, height)
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('renderTextToImageBitmap: 2d context unavailable')
  ctx.drawImage(img, 0, 0, width, height)
  return await createImageBitmap(canvas)
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
