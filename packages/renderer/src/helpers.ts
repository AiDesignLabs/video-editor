import type { ITransform, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { PixiDisplayObject } from './types'
import { toRaw } from '@vue/reactivity'
import { Graphics, Sprite, Texture } from 'pixi.js'

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

export function collectActiveSegments(protocol: IVideoProtocol, at: number) {
  const active: { segment: SegmentUnion, trackIndex: number, childIndex: number }[] = []
  protocol.tracks.forEach((track, trackIndex) => {
    track.children.forEach((segment, childIndex) => {
      if (segment.startTime <= at && at < segment.endTime)
        active.push({ segment, trackIndex, childIndex })
    })
  })

  return active.sort((a, b) => {
    if (a.trackIndex === b.trackIndex)
      return a.childIndex - b.childIndex
    return a.trackIndex - b.trackIndex
  })
}

export function applyDisplayProps(display: PixiDisplayObject, segment: SegmentUnion, width: number, height: number) {
  const opacity = readOpacity(segment)
  // size
  if (display instanceof Sprite) {
    display.anchor.set(0.5)
    display.width = width
    display.height = height
    display.x = width / 2
    display.y = height / 2
    const src = display.texture.source as { addEventListener?: (type: string, cb: () => void, opts?: AddEventListenerOptions) => void } | undefined
    src?.addEventListener?.('error', () => {
      // fallback to a colored rect if texture failed
      display.texture = Texture.from(placeholderTexture(width, height))
    }, { once: true })
  }
  else if (display instanceof Graphics) {
    display.clear()
    display
      .rect(0, 0, width, height)
      .fill({ color: stringToColor('url' in segment && typeof segment.url === 'string' ? segment.url : segment.segmentType), alpha: hasOpacity(segment) ? opacity : 0.35 })
    display.pivot.set(width / 2, height / 2)
    display.position.set(width / 2, height / 2)
  }

  display.alpha = opacity

  // simple 2D transform
  const transform = readTransform(segment)
  if (transform) {
    const [px, py] = transform.position ?? [0, 0]
    const [sx, sy] = transform.scale ?? [1, 1]
    const rotation = transform.rotation?.[2] ?? 0

    display.position.set(width / 2 + (px * width) / 2, height / 2 - (py * height) / 2)
    display.scale.set(sx, sy)
    display.rotation = (rotation / 180) * Math.PI
  }
}

export function placeholder(key: string, url?: string) {
  const g = new Graphics()
  g.rect(0, 0, 10, 10).fill({ color: stringToColor(url ?? key), alpha: 1 })
  return g
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

function hasTransform(segment: SegmentUnion): segment is SegmentUnion & { transform?: ITransform } {
  return 'transform' in segment
}

function readTransform(segment: SegmentUnion) {
  if (hasTransform(segment))
    return segment.transform
  return undefined
}
