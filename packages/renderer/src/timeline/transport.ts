import type { TransportSnapshot } from './types'

export interface CreateTimelineTransportOptions {
  now?: () => number
  initialTimelineMs?: number
  initialRate?: number
  playing?: boolean
}

export interface TimelineTransport {
  getSnapshot: (nowMs?: number) => TransportSnapshot
  play: (nowMs?: number) => TransportSnapshot
  pause: (nowMs?: number) => TransportSnapshot
  seek: (timelineMs: number, nowMs?: number) => TransportSnapshot
  setRate: (rate: number, nowMs?: number) => TransportSnapshot
  subscribe: (listener: (snapshot: TransportSnapshot) => void) => () => void
}

const MIN_PLAY_RATE = 0.1
const MAX_PLAY_RATE = 100

export function createTimelineTransport(
  opts: CreateTimelineTransportOptions = {},
): TimelineTransport {
  const nowProvider = opts.now ?? defaultNow
  let playing = Boolean(opts.playing)
  let rate = normalizeRate(opts.initialRate)
  let discontinuitySeq = 0
  let epochWallMs = resolveNow(undefined, nowProvider)
  let epochTimelineMs = normalizeTimelineMs(opts.initialTimelineMs)

  const listeners = new Set<(snapshot: TransportSnapshot) => void>()

  if (playing)
    epochWallMs = resolveNow(undefined, nowProvider)

  const currentTimelineMs = (nowMs: number) =>
    playing ? epochTimelineMs + (nowMs - epochWallMs) * rate : epochTimelineMs

  const snapshotAt = (nowMs: number): TransportSnapshot => ({
    playing,
    timelineMs: normalizeTimelineMs(currentTimelineMs(nowMs)),
    rate,
    epochWallMs,
    epochTimelineMs,
    discontinuitySeq,
  })

  const emit = (snapshot: TransportSnapshot) => {
    for (const listener of listeners)
      listener(snapshot)
  }

  const anchorAt = (timelineMs: number, nowMs: number) => {
    epochTimelineMs = normalizeTimelineMs(timelineMs)
    epochWallMs = nowMs
  }

  return {
    getSnapshot(nowMs) {
      return snapshotAt(resolveNow(nowMs, nowProvider))
    },

    play(nowMs) {
      const resolvedNow = resolveNow(nowMs, nowProvider)
      if (!playing) {
        const timelineMs = currentTimelineMs(resolvedNow)
        playing = true
        anchorAt(timelineMs, resolvedNow)
      }
      const snapshot = snapshotAt(resolvedNow)
      emit(snapshot)
      return snapshot
    },

    pause(nowMs) {
      const resolvedNow = resolveNow(nowMs, nowProvider)
      if (playing) {
        const timelineMs = currentTimelineMs(resolvedNow)
        playing = false
        anchorAt(timelineMs, resolvedNow)
      }
      const snapshot = snapshotAt(resolvedNow)
      emit(snapshot)
      return snapshot
    },

    seek(timelineMs, nowMs) {
      const resolvedNow = resolveNow(nowMs, nowProvider)
      anchorAt(timelineMs, resolvedNow)
      discontinuitySeq += 1
      const snapshot = snapshotAt(resolvedNow)
      emit(snapshot)
      return snapshot
    },

    setRate(nextRate, nowMs) {
      const resolvedNow = resolveNow(nowMs, nowProvider)
      const normalizedNextRate = normalizeRate(nextRate)
      const timelineMs = currentTimelineMs(resolvedNow)
      anchorAt(timelineMs, resolvedNow)
      if (Math.abs(rate - normalizedNextRate) > 0.0001) {
        rate = normalizedNextRate
        discontinuitySeq += 1
      }
      const snapshot = snapshotAt(resolvedNow)
      emit(snapshot)
      return snapshot
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function resolveNow(nowMs: number | undefined, nowProvider: () => number): number {
  if (typeof nowMs === 'number' && Number.isFinite(nowMs))
    return nowMs
  return nowProvider()
}

function normalizeTimelineMs(timelineMs: number | undefined): number {
  if (typeof timelineMs !== 'number' || !Number.isFinite(timelineMs))
    return 0
  return Math.max(0, timelineMs)
}

function normalizeRate(rate: number | undefined): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate))
    return 1
  return Math.min(MAX_PLAY_RATE, Math.max(MIN_PLAY_RATE, rate))
}

function defaultNow() {
  if (typeof globalThis.performance !== 'undefined' && typeof globalThis.performance.now === 'function')
    return globalThis.performance.now()
  return Date.now()
}
