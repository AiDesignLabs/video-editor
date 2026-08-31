/**
 * Vertical track geometry.
 *
 * The timeline used to assume every row was `trackHeight` tall and derived a
 * row's top with `index * (trackHeight + trackGap)`. Rows are uniform again by
 * default, but `trackHeightByType` lets a consumer make them differ, and that
 * arithmetic is wrong the moment two rows do. Everything vertical goes through
 * this module — the single place that knows where a row starts and how tall it
 * is — so mixed heights stay correct for drag hit-testing, previews and seams.
 */

export interface TrackMetrics {
  /** Height of each row, in source order. */
  heights: number[]
  /** Top edge of each row, relative to the top of the track area (gaps included). */
  tops: number[]
  /** Total height of the track area, including the gap above the first row. */
  totalHeight: number
  /** Gap between adjacent rows. */
  gap: number
}

export interface BuildTrackMetricsOptions {
  heights: number[]
  gap: number
}

/**
 * Rows are laid out as `gap, row0, gap, row1, …` — the leading gap matches the
 * old `index * (h + gap) + gap` formula, so existing offsets are preserved when
 * every row has the same height.
 */
export function buildTrackMetrics({ heights, gap }: BuildTrackMetricsOptions): TrackMetrics {
  const safeGap = Number.isFinite(gap) ? Math.max(gap, 0) : 0
  const safeHeights = heights.map(h => (Number.isFinite(h) ? Math.max(h, 0) : 0))
  const tops: number[] = []

  let cursor = safeGap
  for (const height of safeHeights) {
    tops.push(cursor)
    cursor += height + safeGap
  }

  return {
    heights: safeHeights,
    tops,
    totalHeight: cursor,
    gap: safeGap,
  }
}

/** Top edge of a row; falls back to the end of the stack for out-of-range input. */
export function trackTopAt(metrics: TrackMetrics, index: number): number {
  if (index < 0)
    return metrics.gap
  return metrics.tops[index] ?? metrics.totalHeight
}

/** Height of a row; falls back to the last known height. */
export function trackHeightAt(metrics: TrackMetrics, index: number): number {
  if (!metrics.heights.length)
    return 0
  if (index < 0)
    return metrics.heights[0]
  return metrics.heights[index] ?? metrics.heights[metrics.heights.length - 1]
}

/**
 * Row containing `y`, or -1 above the first row.
 *
 * A `y` inside a gap resolves to the row that follows it, so dragging never
 * reports "no track" while the pointer is between two rows.
 */
export function trackIndexAtY(metrics: TrackMetrics, y: number): number {
  const count = metrics.heights.length
  if (!count || y < 0)
    return -1
  for (let i = 0; i < count; i++) {
    const bottom = metrics.tops[i] + metrics.heights[i] + metrics.gap
    if (y < bottom)
      return i
  }
  return count - 1
}

/**
 * Insertion index when `y` falls in the gap between two rows, else null.
 *
 * The band counts as a gap only within half a gap either side of the boundary,
 * matching the previous behaviour.
 */
export function trackGapIndexAtY(metrics: TrackMetrics, y: number): number | null {
  const count = metrics.heights.length
  if (!count)
    return null

  const half = metrics.gap / 2
  if (y < metrics.tops[0] - half)
    return 0

  for (let i = 0; i < count; i++) {
    const boundary = metrics.tops[i] + metrics.heights[i]
    if (y >= boundary - half && y < boundary + metrics.gap + half)
      return i + 1
  }
  return null
}
