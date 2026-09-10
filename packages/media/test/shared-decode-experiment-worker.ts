/// <reference lib="webworker" />
import { runSharedDecodeExperiment } from './shared-decode-experiment'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
scope.onmessage = async (event: MessageEvent<Parameters<typeof runSharedDecodeExperiment>>) => {
  try {
    scope.postMessage({ result: await runSharedDecodeExperiment(...event.data) })
  }
  catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
