import type { IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { TrackTypeMapTrack } from '@video-editor/shared'
import type { PixiDisplayObject } from './types'
import { toRaw } from '@vue/reactivity'
import { Graphics, Sprite, Texture } from 'pixi.js'
import { computeSegmentLayout } from './layout'

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
    const aTrack = protocol.tracks[a.trackIndex]
    const bTrack = protocol.tracks[b.trackIndex]
    const aIsMain = aTrack?.trackType === 'frames' && (aTrack as TrackTypeMapTrack['frames']).isMain
    const bIsMain = bTrack?.trackType === 'frames' && (bTrack as TrackTypeMapTrack['frames']).isMain
    const total = protocol.tracks.length
    const aOrder = aIsMain ? 0 : total - a.trackIndex
    const bOrder = bIsMain ? 0 : total - b.trackIndex
    if (aOrder !== bOrder)
      return aOrder - bOrder
    if (a.trackIndex === b.trackIndex)
      return a.childIndex - b.childIndex
    return a.trackIndex - b.trackIndex
  })
}

export function applyDisplayProps(display: PixiDisplayObject, segment: SegmentUnion, width: number, height: number) {
  const opacity = readOpacity(segment)
  const sourceWidth = display instanceof Sprite ? display.texture.width || width : width
  const sourceHeight = display instanceof Sprite ? display.texture.height || height : height
  const layout = computeSegmentLayout(segment, width, height, sourceWidth, sourceHeight)

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
