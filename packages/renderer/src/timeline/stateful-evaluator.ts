import type { IVideoProtocol } from '@video-editor/shared'
import type { EvalContext, EvaluatorState, TimelinePlan } from './types'
import { createEmptyEvaluatorState, evaluateTimelinePlan } from './evaluator'

export interface StatefulTimelineEvaluator {
  evaluate: (protocol: IVideoProtocol, context: EvalContext) => TimelinePlan
  reset: () => void
  getState: () => EvaluatorState
}

export function createStatefulTimelineEvaluator(): StatefulTimelineEvaluator {
  let state = createEmptyEvaluatorState()

  return {
    evaluate(protocol, context) {
      const output = evaluateTimelinePlan(protocol, context, state)
      state = output.state
      return output.plan
    },
    reset() {
      state = createEmptyEvaluatorState()
    },
    getState() {
      return state
    },
  }
}
