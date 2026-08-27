import type { ITextBasic } from '@video-editor/shared'
import type { RenderedTextBitmap, TextRun } from './text-bitmap'
import { renderTextRunsToImageBitmap } from './text-bitmap'

export type { RenderedTextBitmap, TextRun } from './text-bitmap'

const DEFAULT_TEXT_BITMAP_CACHE_LIMIT = 100
const textBitmapCache = new Map<string, RenderedTextBitmap>()
let textBitmapCacheLimit = DEFAULT_TEXT_BITMAP_CACHE_LIMIT

function touchCache(key: string, value: RenderedTextBitmap) {
  textBitmapCache.delete(key)
  textBitmapCache.set(key, value)
}

function trimCache() {
  while (textBitmapCache.size > textBitmapCacheLimit) {
    const [oldestKey, rendered] = textBitmapCache.entries().next().value as [string, RenderedTextBitmap]
    textBitmapCache.delete(oldestKey)
    rendered.bitmap.close?.()
  }
}

export function setTextBitmapCacheLimit(limit: number) {
  textBitmapCacheLimit = Math.max(0, Math.floor(limit))
  trimCache()
}

export function clearTextBitmapCache() {
  for (const rendered of textBitmapCache.values())
    rendered.bitmap.close?.()
  textBitmapCache.clear()
}

export function buildTextContent(texts: ITextBasic[]) {
  return texts.map(item => item.content).filter(Boolean).join('\n')
}

/** Each ITextBasic renders as one line with its own style. */
export function buildTextRuns(texts: ITextBasic[]): TextRun[] {
  return texts
    .filter(item => !!item.content)
    .map(item => ({ content: item.content ?? '', cssText: buildTextCss(item) }))
}

function applyColorOpacity(color: string, opacity?: number) {
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity >= 1)
    return color
  const clamped = Math.max(0, opacity)
  return `color-mix(in srgb, ${color} ${clamped * 100}%, transparent)`
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
    css.push(`background: ${applyColorOpacity(text.background.color, text.background.opacity)}`)
  if (text.stroke?.color && typeof text.stroke.width === 'number')
    css.push(`-webkit-text-stroke: ${text.stroke.width}px ${applyColorOpacity(text.stroke.color, text.stroke.opacity)}`)
  if (text.underline)
    css.push('text-decoration: underline')
  if (text.dropShadow?.color && typeof text.dropShadow.distance === 'number') {
    const angle = (text.dropShadow.angle ?? 45) * (Math.PI / 180)
    const offsetX = Math.cos(angle) * text.dropShadow.distance
    const offsetY = Math.sin(angle) * text.dropShadow.distance
    const blur = text.dropShadow.blur ?? 0
    css.push(`text-shadow: ${offsetX}px ${offsetY}px ${blur}px ${applyColorOpacity(text.dropShadow.color, text.dropShadow.opacity)}`)
  }

  return css.join('; ')
}

export async function renderTextBitmap(runs: TextRun[], scale?: number) {
  const key = `${JSON.stringify(runs)}::s${scale ?? 'auto'}`
  const cached = textBitmapCache.get(key)
  if (cached) {
    touchCache(key, cached)
    return cached
  }

  const bitmap = await renderTextRunsToImageBitmap(runs, scale)
  if (textBitmapCacheLimit > 0) {
    textBitmapCache.set(key, bitmap)
    trimCache()
  }
  return bitmap
}
