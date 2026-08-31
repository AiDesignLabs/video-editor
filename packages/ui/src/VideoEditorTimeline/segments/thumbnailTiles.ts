/**
 * Laying extracted frames out along a segment.
 *
 * The naive rendering — one element per extracted frame, flexed to fill — is
 * wrong whenever the number of frames does not match the segment's width, and
 * that is the common case:
 *
 *   - the segment is trimmed, so `fromTime > 0` and the frames cover a window
 *     of the source file rather than the whole of it;
 *   - `generateThumbnails` clamps its step to a 200ms minimum, so a long
 *     segment gets fewer frames than it has room for and the tail is bare;
 *   - a segment shorter than the preferred sample count gets fewer frames than
 *     requested.
 *
 * So the strip is tiled at a fixed size instead, and each tile asks for the
 * frame nearest its own timestamp in the source file. That stays correct
 * whatever the sampling did, and repeats the last frame rather than leaving a
 * gap when the frames run out.
 */

export interface ThumbnailFrame {
  /** Timestamp in the *source file*, milliseconds. */
  tsMs: number
  url: string
}

export interface ThumbnailTile {
  /** Tile index, stable across re-renders — usable as a list key. */
  index: number
  /** Frame to paint, or `null` when nothing has been extracted yet. */
  url: string | null
}

/** Default tile edge in CSS pixels; matches `--ve-segment-thumbnail-size`. */
export const THUMBNAIL_TILE_SIZE = 56

/**
 * The frame whose timestamp is closest to `videoTimeMs`.
 *
 * Returns the first frame for a non-finite time and `null` for no frames, so
 * callers never have to guard.
 */
export function pickThumbnailByTime(frames: ThumbnailFrame[], videoTimeMs: number): string | null {
  if (frames.length === 0)
    return null
  if (frames.length === 1 || !Number.isFinite(videoTimeMs))
    return frames[0]?.url ?? null

  let closest = frames[0] as ThumbnailFrame
  let minDistance = Math.abs(closest.tsMs - videoTimeMs)
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i]
    if (!frame)
      continue
    const distance = Math.abs(frame.tsMs - videoTimeMs)
    if (distance < minDistance) {
      minDistance = distance
      closest = frame
    }
  }
  return closest.url
}

export interface ThumbnailTileOptions {
  frames: ThumbnailFrame[]
  /** Rendered width of the strip, CSS pixels. */
  width: number
  /** Segment duration on the timeline, milliseconds. */
  durationMs: number
  /** Segment's in-point in the source file, milliseconds. */
  fromTimeMs?: number
  tileSize?: number
}

export function buildThumbnailTiles(options: ThumbnailTileOptions): ThumbnailTile[] {
  const { frames, width, durationMs, fromTimeMs = 0, tileSize = THUMBNAIL_TILE_SIZE } = options

  if (!Number.isFinite(width) || width <= 0 || tileSize <= 0)
    return []

  const count = Math.max(1, Math.ceil(width / tileSize))
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0
  const safeFrom = Number.isFinite(fromTimeMs) ? fromTimeMs : 0

  return Array.from({ length: count }, (_, index) => {
    /*
     * Anchor on the tile's own pixel centre, not on `(index + 0.5) / count`.
     * The last tile is usually clipped by the strip's `overflow: hidden`, but
     * its background is still painted across the full tile, so its visible
     * centre is where the unclipped centre would be. Dividing by `count`
     * instead would quietly skew the rightmost tile.
     */
    const tileCenterPx = (index + 0.5) * tileSize
    const positionRatio = Math.min(Math.max(tileCenterPx / width, 0), 1)
    const videoTimeMs = safeFrom + positionRatio * safeDuration
    return { index, url: pickThumbnailByTime(frames, videoTimeMs) }
  })
}
