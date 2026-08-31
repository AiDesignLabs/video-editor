import type { ThumbnailFrame } from './thumbnailTiles'
import { describe, expect, it } from 'vitest'
import { buildThumbnailTiles, pickThumbnailByTime, THUMBNAIL_TILE_SIZE } from './thumbnailTiles'

const frames: ThumbnailFrame[] = [
  { tsMs: 0, url: 'a' },
  { tsMs: 1000, url: 'b' },
  { tsMs: 2000, url: 'c' },
]

describe('pickThumbnailByTime', () => {
  it('returns the nearest frame', () => {
    expect(pickThumbnailByTime(frames, 0)).toBe('a')
    expect(pickThumbnailByTime(frames, 900)).toBe('b')
    expect(pickThumbnailByTime(frames, 1600)).toBe('c')
  })

  it('clamps past the end to the last frame rather than leaving a gap', () => {
    expect(pickThumbnailByTime(frames, 99_999)).toBe('c')
  })

  it('degrades gracefully', () => {
    expect(pickThumbnailByTime([], 500)).toBeNull()
    expect(pickThumbnailByTime(frames, Number.NaN)).toBe('a')
    expect(pickThumbnailByTime([{ tsMs: 5, url: 'only' }], 999)).toBe('only')
  })
})

describe('buildThumbnailTiles', () => {
  it('tiles the strip at the tile size, covering the full width', () => {
    const tiles = buildThumbnailTiles({ frames, width: 200, durationMs: 2000 })
    expect(tiles).toHaveLength(Math.ceil(200 / THUMBNAIL_TILE_SIZE))
    expect(tiles.map(tile => tile.index)).toEqual([0, 1, 2, 3])
  })

  it('maps each tile to the frame at its own position in the segment', () => {
    // 112px = exactly two tiles, whose centres sit at 25% and 75% of a 2s span,
    // i.e. 500ms and 1500ms. Both are exact ties between two frames, and a tie
    // keeps the earlier frame.
    const tiles = buildThumbnailTiles({ frames, width: 112, durationMs: 2000 })
    expect(tiles.map(tile => tile.url)).toEqual(['a', 'b'])
  })

  it('picks the later frame once the tile centre passes the midpoint', () => {
    const tiles = buildThumbnailTiles({ frames: [{ tsMs: 0, url: 'a' }, { tsMs: 1000, url: 'b' }], width: 56, durationMs: 1200 })
    // Single tile, centre at 600ms — nearer 1000 than 0.
    expect(tiles.map(tile => tile.url)).toEqual(['b'])
  })

  it('offsets by the segment in-point, so a trimmed segment shows the right frames', () => {
    const tiles = buildThumbnailTiles({ frames, width: 112, durationMs: 1000, fromTimeMs: 1000 })
    // Centres now land at 1250ms and 1750ms of the source file.
    expect(tiles.map(tile => tile.url)).toEqual(['b', 'c'])
  })

  it('repeats the last frame when extraction stopped short of the segment', () => {
    // One frame for a strip that has room for four: every tile still paints.
    const tiles = buildThumbnailTiles({ frames: [{ tsMs: 0, url: 'only' }], width: 200, durationMs: 8000 })
    expect(tiles.every(tile => tile.url === 'only')).toBe(true)
  })

  it('anchors the clipped last tile on its own centre, not on a share of the count', () => {
    // 120px is 2 full tiles plus an 8px sliver. The third tile is painted across
    // a full 56px, so its centre is at 140px — past the strip — and must clamp
    // to the end rather than being read as 5/6 of the way through.
    const tiles = buildThumbnailTiles({ frames, width: 120, durationMs: 2000 })
    expect(tiles).toHaveLength(3)
    expect(tiles[2]?.url).toBe('c')
  })

  it('returns nothing without a measured width', () => {
    expect(buildThumbnailTiles({ frames, width: 0, durationMs: 2000 })).toEqual([])
    expect(buildThumbnailTiles({ frames, width: Number.NaN, durationMs: 2000 })).toEqual([])
  })

  it('still tiles when the segment has no duration', () => {
    const tiles = buildThumbnailTiles({ frames, width: 112, durationMs: 0 })
    expect(tiles.map(tile => tile.url)).toEqual(['a', 'a'])
  })
})
