import type { IVideoProtocol } from '@video-editor/shared'
import type { TimelineTransport } from './transport'
import type { EvaluatorState, TimelinePlan } from './types'
import { createStatefulTimelineEvaluator } from './stateful-evaluator'

const DEFAULT_LOOKBACK_MS = 20
const DEFAULT_LOOKAHEAD_MS = 100

export interface CreatePreviewRunnerOptions {
  transport: TimelineTransport
  lookbackMs?: number
  lookaheadMs?: number
}

export interface PreviewRunner {
  evaluate: (protocol: IVideoProtocol, atMs?: number) => TimelinePlan
  reset: () => void
  getState: () => EvaluatorState
}

export function createPreviewRunner(opts: CreatePreviewRunnerOptions): PreviewRunner {
  const lookbackMs = normalizeWindowMs(opts.lookbackMs, DEFAULT_LOOKBACK_MS)
  const lookaheadMs = normalizeWindowMs(opts.lookaheadMs, DEFAULT_LOOKAHEAD_MS)
  const evaluator = createStatefulTimelineEvaluator()
  let lastDiscontinuitySeq = opts.transport.getSnapshot().discontinuitySeq

  return {
    evaluate(protocol, atMs) {
      const snapshot = opts.transport.getSnapshot()
      const timelineMs = normalizeTimelineMs(typeof atMs === 'number' ? atMs : snapshot.timelineMs)
      const discontinuity = snapshot.discontinuitySeq !== lastDiscontinuitySeq
      if (discontinuity)
        lastDiscontinuitySeq = snapshot.discontinuitySeq

      return evaluator.evaluate(protocol, {
        atMs: timelineMs,
        windowStartMs: Math.max(0, timelineMs - lookbackMs),
        windowEndMs: timelineMs + lookaheadMs,
        fps: Math.max(protocol.fps || 30, 1),
        discontinuity,
      })
    },

    reset() {
      evaluator.reset()
      lastDiscontinuitySeq = opts.transport.getSnapshot().discontinuitySeq
    },

    getState() {
      return evaluator.getState()
    },
  }
}

function normalizeWindowMs(windowMs: number | undefined, fallback: number): number {
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs))
    return fallback
  return Math.max(0, windowMs)
}

function normalizeTimelineMs(timelineMs: number): number {
  if (!Number.isFinite(timelineMs))
    return 0
  return Math.max(0, timelineMs)
}
