import type { ITransform, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { SegmentLayout } from './layout'
import type { PixiDisplayObject } from './types'
import { toRaw } from '@vue/reactivity'
import { Graphics, Sprite, Texture } from 'pixi.js'
import { computeSegmentLayout, resolveFillSize } from './layout'

export function collectResourceUrls(protocol: IVideoProtocol) {
  const urls = new Set<string>()
  for (const track of protocol.tracks) {
    for (const segment of track.children) {
      if (segment.url)
        urls.add(segment.url)
    }
  }
  return urls
}

export interface ApplyDisplayPropsOptions {
  opacity?: number
  transform?: ITransform
}

export interface DisplayLayoutResult {
  layout: SegmentLayout
  /** Fill-mode resolved size on stage BEFORE the transform scale is applied. */
  baseWidth: number
  baseHeight: number
}

/**
 * Resolve the on-stage layout of a display without mutating it.
 * Shared by `applyDisplayProps` and the renderer's visual box snapshot.
 */
export function computeDisplayLayout(
  display: PixiDisplayObject,
  segment: SegmentUnion,
  width: number,
  height: number,
  transform?: ITransform,
): DisplayLayoutResult {
  const sourceWidth = display instanceof Sprite ? display.texture.width || width : width
  const sourceHeight = display instanceof Sprite ? display.texture.height || height : height
  const fillMode = 'fillMode' in segment ? segment.fillMode : undefined
  const base = resolveFillSize(fillMode, sourceWidth, sourceHeight, width, height)
  const layout = computeSegmentLayout(segment, width, height, sourceWidth, sourceHeight, transform)
  return { layout, baseWidth: base.width, baseHeight: base.height }
}

export function applyDisplayProps(
  display: PixiDisplayObject,
  segment: SegmentUnion,
  width: number,
  height: number,
  options: ApplyDisplayPropsOptions = {},
): DisplayLayoutResult {
  const opacity = normalizeOpacity(options.opacity ?? readOpacity(segment))
  const result = computeDisplayLayout(display, segment, width, height, options.transform)
  const { layout } = result

  if (display instanceof Sprite) {
    display.anchor.set(0.5)
    display.width = layout.width
    display.height = layout.height
    display.position.set(layout.centerX, layout.centerY)
    display.rotation = layout.rotationRad
    const src = display.texture.source as { addEventListener?: (type: string, cb: () => void, opts?: AddEventListenerOptions) => void } | undefined
    src?.addEventListener?.('error', () => {
      // fallback to a colored rect if texture failed
      display.texture = Texture.from(placeholderTexture(width, height))
    }, { once: true })
  }
  else if (display instanceof Graphics) {
    display.clear()
    display
      .rect(0, 0, layout.width, layout.height)
      .fill({ color: stringToColor('url' in segment && typeof segment.url === 'string' ? segment.url : segment.segmentType), alpha: hasOpacity(segment) ? opacity : 0.35 })
    display.pivot.set(layout.width / 2, layout.height / 2)
    display.position.set(layout.centerX, layout.centerY)
    display.rotation = layout.rotationRad
  }

  display.alpha = opacity

  return result
}

const placeholderDisplays = new WeakSet<object>()

export function placeholder(key: string, url?: string) {
  const g = new Graphics()
  g.rect(0, 0, 10, 10).fill({ color: stringToColor(url ?? key), alpha: 1 })
  placeholderDisplays.add(g)
  return g
}

/**
 * Placeholders stand in for a display whose real resource failed to load;
 * they must never be cached so the next render retries the real load.
 */
export function isPlaceholderDisplay(display: object) {
  return placeholderDisplays.has(display)
}

export function placeholderTexture(width: number, height: number, color?: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color ?? '#0f172a'}" fill-opacity="0.8"/></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

export function stringToColor(key: string) {
  let hash = 0
  for (let i = 0; i < key.length; i++)
    hash = key.charCodeAt(i) + ((hash << 5) - hash)
  return hash & 0x00FFFFFF
}

export function computeDuration(protocol: IVideoProtocol) {
  const endTimes = protocol.tracks.flatMap(track => track.children.map(seg => seg.endTime))
  return endTimes.length ? Math.max(...endTimes) : 0
}

export function clamp(num: number, min: number, max: number) {
  return Math.min(Math.max(num, min), max)
}

export function cloneProtocol(protocol: IVideoProtocol) {
  const raw = toRaw(protocol) as IVideoProtocol
  // use JSON clone to avoid structuredClone errors on proxies (e.g., Vue reactive)
  return JSON.parse(JSON.stringify(raw)) as IVideoProtocol
}

function hasOpacity(segment: SegmentUnion): segment is SegmentUnion & { opacity?: number } {
  return 'opacity' in segment
}

function readOpacity(segment: SegmentUnion) {
  if (hasOpacity(segment) && typeof segment.opacity === 'number')
    return segment.opacity
  return 1
}

function normalizeOpacity(opacity: number) {
  if (!Number.isFinite(opacity))
    return 1
  return Math.min(Math.max(opacity, 0), 1)
}
