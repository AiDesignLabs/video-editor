import type { IVideoProtocol } from '@video-editor/shared'
import type { EvalContext, EvaluatorState, TimelinePlan } from './types'
import { createStatefulTimelineEvaluator } from './stateful-evaluator'

export interface ComposeRunnerEvaluateOptions {
  windowStartMs?: number
  windowEndMs?: number
  discontinuity?: boolean
}

export interface ComposeRunner {
  evaluateAt: (
    protocol: IVideoProtocol,
    atMs: number,
    options?: ComposeRunnerEvaluateOptions,
  ) => TimelinePlan
  evaluateSequence: (protocol: IVideoProtocol, atMsList: number[]) => TimelinePlan[]
  reset: () => void
  getState: () => EvaluatorState
}

export function createComposeRunner(): ComposeRunner {
  const evaluator = createStatefulTimelineEvaluator()
  let lastAtMs: number | undefined

  return {
    evaluateAt(protocol, atMs, options = {}) {
      const normalizedAtMs = normalizeTimelineMs(atMs)
      const windowStartMs = normalizeTimelineMs(options.windowStartMs ?? normalizedAtMs)
      const windowEndMs = Math.max(
        windowStartMs,
        normalizeTimelineMs(options.windowEndMs ?? normalizedAtMs),
      )

      const context: EvalContext = {
        atMs: normalizedAtMs,
        windowStartMs,
        windowEndMs,
        fps: Math.max(protocol.fps || 30, 1),
        discontinuity:
          typeof options.discontinuity === 'boolean'
            ? options.discontinuity
            : (lastAtMs !== undefined && normalizedAtMs < lastAtMs),
      }

      lastAtMs = normalizedAtMs
      return evaluator.evaluate(protocol, context)
    },

    evaluateSequence(protocol, atMsList) {
      const plans: TimelinePlan[] = []
      for (const atMs of atMsList)
        plans.push(this.evaluateAt(protocol, atMs))
      return plans
    },

    reset() {
      evaluator.reset()
      lastAtMs = undefined
    },

    getState() {
      return evaluator.getState()
    },
  }
}

function normalizeTimelineMs(timelineMs: number | undefined): number {
  if (typeof timelineMs !== 'number' || !Number.isFinite(timelineMs))
    return 0
  return Math.max(0, timelineMs)
}
