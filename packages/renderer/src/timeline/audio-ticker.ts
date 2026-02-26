import type { IVideoProtocol } from '@video-editor/shared'
import type { PreviewRunner } from './preview-runner'
import type { TimelineTransport } from './transport'
import type { TimelinePlan, TransportSnapshot } from './types'

const DEFAULT_TICK_INTERVAL_MS = 20

type IntervalHandle = ReturnType<typeof setInterval>

export interface CreatePreviewAudioTickerOptions {
  transport: TimelineTransport
  runner: PreviewRunner
  getProtocol: () => IVideoProtocol
  onPlan: (plan: TimelinePlan, snapshot: TransportSnapshot) => void
  intervalMs?: number
  setInterval?: (callback: () => void, intervalMs: number) => IntervalHandle
  clearInterval?: (handle: IntervalHandle) => void
}

export interface PreviewAudioTicker {
  start: () => void
  stop: () => void
  tick: () => TimelinePlan
  isRunning: () => boolean
}

export function createPreviewAudioTicker(opts: CreatePreviewAudioTickerOptions): PreviewAudioTicker {
  const intervalMs = normalizeIntervalMs(opts.intervalMs, DEFAULT_TICK_INTERVAL_MS)
  const setIntervalFn = opts.setInterval ?? ((callback: () => void, tickIntervalMs: number) => {
    return globalThis.setInterval(callback, tickIntervalMs) as IntervalHandle
  })
  const clearIntervalFn = opts.clearInterval ?? ((handle: IntervalHandle) => {
    globalThis.clearInterval(handle)
  })
  let timer: IntervalHandle | undefined

  const tick = () => {
    const snapshot = opts.transport.getSnapshot()
    const plan = opts.runner.evaluate(opts.getProtocol(), snapshot.timelineMs)
    opts.onPlan(plan, snapshot)
    return plan
  }

  return {
    start() {
      if (timer !== undefined)
        return
      tick()
      timer = setIntervalFn(() => {
        tick()
      }, intervalMs)
    },

    stop() {
      if (timer === undefined)
        return
      clearIntervalFn(timer)
      timer = undefined
    },

    tick,

    isRunning() {
      return timer !== undefined
    },
  }
}

function normalizeIntervalMs(intervalMs: number | undefined, fallback: number): number {
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs))
    return fallback
  return Math.max(1, intervalMs)
}
