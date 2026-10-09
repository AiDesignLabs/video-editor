interface Rect { left: number, right: number, top: number, bottom: number }

/** Keep the card beside the whole picker, not over another option in its row. */
export function placePresetPreview(picker: Rect, anchor: Rect, viewport: { width: number, height: number }) {
  const margin = 8
  const gap = 12
  const width = Math.min(256, viewport.width - margin * 2)
  const height = width * 9 / 16 + 44
  const clamp = (value: number, max: number) => Math.max(margin, Math.min(value, max - margin))
  if (picker.left - gap - width >= margin)
    return { left: picker.left - gap - width, top: clamp(anchor.top, viewport.height - height), width }
  if (picker.right + gap + width <= viewport.width - margin)
    return { left: picker.right + gap, top: clamp(anchor.top, viewport.height - height), width }
  // On narrow screens use free space above or below the hovered item.
  const above = anchor.top - gap - margin
  const below = viewport.height - margin - anchor.bottom - gap
  const useAbove = above > below
  const availableHeight = Math.max(0, useAbove ? above : below)
  const fittedWidth = Math.min(width, Math.max(0, (availableHeight - 44) * 16 / 9))
  if (fittedWidth < 96)
    return undefined
  const fittedHeight = fittedWidth * 9 / 16 + 44
  return {
    left: clamp(anchor.left, viewport.width - fittedWidth),
    top: useAbove ? anchor.top - gap - fittedHeight : anchor.bottom + gap,
    width: fittedWidth,
  }
}
