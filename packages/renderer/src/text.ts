import type { ITextBasic } from '@video-editor/shared'
import { renderTxt2ImgBitmap } from '@webav/av-cliper'

const DEFAULT_TEXT_BITMAP_CACHE_LIMIT = 100
const textBitmapCache = new Map<string, ImageBitmap>()
let textBitmapCacheLimit = DEFAULT_TEXT_BITMAP_CACHE_LIMIT

function touchCache(key: string, value: ImageBitmap) {
  textBitmapCache.delete(key)
  textBitmapCache.set(key, value)
}

function trimCache() {
  while (textBitmapCache.size > textBitmapCacheLimit) {
    const [oldestKey, bitmap] = textBitmapCache.entries().next().value as [string, ImageBitmap]
    textBitmapCache.delete(oldestKey)
    bitmap.close?.()
  }
}

export function setTextBitmapCacheLimit(limit: number) {
  textBitmapCacheLimit = Math.max(0, Math.floor(limit))
  trimCache()
}

export function clearTextBitmapCache() {
  for (const bitmap of textBitmapCache.values())
    bitmap.close?.()
  textBitmapCache.clear()
}

export function buildTextContent(texts: ITextBasic[]) {
  return texts.map(item => item.content).filter(Boolean).join('\n')
}

export function buildTextCss(text: ITextBasic) {
  const fontFamily = Array.isArray(text.fontFamily)
    ? text.fontFamily.join(', ')
    : text.fontFamily
  const fontSize = text.fontSize ?? 32
  const fontWeight = text.fontWeight ?? 'normal'
  const fontStyle = text.fontStyle ?? 'normal'
  const fill = text.fill ?? '#ffffff'
  const align = text.align ?? 'left'

  const css: string[] = [
    `font-size: ${fontSize}px`,
    `font-weight: ${fontWeight}`,
    `font-style: ${fontStyle}`,
    `color: ${fill}`,
    `text-align: ${align}`,
    'white-space: pre-wrap',
  ]

  if (fontFamily)
    css.push(`font-family: ${fontFamily}`)
  if (typeof text.letterSpacing === 'number')
    css.push(`letter-spacing: ${text.letterSpacing}px`)
  if (typeof text.leading === 'number')
    css.push(`line-height: ${text.leading}px`)
  if (text.background?.color)
    css.push(`background: ${text.background.color}`)
  if (text.stroke?.color && typeof text.stroke.width === 'number')
    css.push(`-webkit-text-stroke: ${text.stroke.width}px ${text.stroke.color}`)
  if (text.underline)
    css.push('text-decoration: underline')
  if (text.dropShadow?.color && typeof text.dropShadow.distance === 'number') {
    const angle = (text.dropShadow.angle ?? 45) * (Math.PI / 180)
    const offsetX = Math.cos(angle) * text.dropShadow.distance
    const offsetY = Math.sin(angle) * text.dropShadow.distance
    const blur = text.dropShadow.blur ?? 0
    css.push(`text-shadow: ${offsetX}px ${offsetY}px ${blur}px ${text.dropShadow.color}`)
  }

  return css.join('; ')
}

export async function renderTextBitmap(content: string, cssText: string) {
  const key = `${cssText}::${content}`
  const cached = textBitmapCache.get(key)
  if (cached) {
    touchCache(key, cached)
    return cached
  }

  const bitmap = await renderTxt2ImgBitmap(content, cssText)
  if (textBitmapCacheLimit > 0) {
    textBitmapCache.set(key, bitmap)
    trimCache()
  }
  return bitmap
}
