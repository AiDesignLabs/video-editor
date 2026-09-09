/// <reference lib="webworker" />

import type { TranscodeProgress } from '@video-editor/media'
import type { MediaProcessor } from '../renditions/media-processor'
import type { MediaProcessorWorkerRequest, MediaProcessorWorkerResponse } from './protocol'
import { createMediaProcessor } from '../renditions/media-processor'

export { createWorkerMediaProcessor } from './client'
export type { WorkerMediaProcessorOptions } from './client'
export type { MediaProcessorWorkerRequest, MediaProcessorWorkerResponse } from './protocol'

const PROGRESS_THROTTLE_MS = 250

export function attachMediaProcessorWorker(
  scope: DedicatedWorkerGlobalScope,
  processor: MediaProcessor = createMediaProcessor(),
) {
  const activeRequests = new Map<string, AbortController>()

  const handleMessage = (event: MessageEvent<MediaProcessorWorkerRequest>) => {
    const message = event.data
    if (message.type === 'cancel') {
      activeRequests.get(message.requestId)?.abort()
      return
    }
    if (activeRequests.has(message.requestId)) {
      postError(scope, message.requestId, new Error(`Media processing request ${message.requestId} is already running.`))
      return
    }

    const controller = new AbortController()
    const progressReporter = message.reportProgress
      ? createProgressReporter(scope, message.requestId)
      : undefined
    activeRequests.set(message.requestId, controller)
    void processor.process({
      source: message.source,
      profiles: message.profiles,
      signal: controller.signal,
      onProgress: progressReporter?.report,
    }).then((renditions) => {
      progressReporter?.flush()
      scope.postMessage({
        type: 'result',
        requestId: message.requestId,
        renditions,
      } satisfies MediaProcessorWorkerResponse)
    }).catch((error: unknown) => {
      postError(scope, message.requestId, error)
    }).finally(() => {
      activeRequests.delete(message.requestId)
    })
  }

  scope.addEventListener('message', handleMessage)
  return () => {
    scope.removeEventListener('message', handleMessage)
    for (const controller of activeRequests.values())
      controller.abort()
    activeRequests.clear()
  }
}

function createProgressReporter(scope: DedicatedWorkerGlobalScope, requestId: string) {
  let lastPostedElapsedMs: number | undefined
  let pendingProgress: TranscodeProgress | undefined

  const post = (progress: TranscodeProgress) => {
    lastPostedElapsedMs = progress.elapsedMs
    pendingProgress = undefined
    scope.postMessage({
      type: 'progress',
      requestId,
      progress,
    } satisfies MediaProcessorWorkerResponse)
  }

  return {
    report(progress: TranscodeProgress) {
      const isComplete = progress.ratio >= 1
        || (progress.framesTotal > 0 && progress.framesDone >= progress.framesTotal)
      if (lastPostedElapsedMs === undefined
        || isComplete
        || progress.elapsedMs - lastPostedElapsedMs >= PROGRESS_THROTTLE_MS) {
        post(progress)
        return
      }
      pendingProgress = progress
    },
    flush() {
      if (pendingProgress)
        post(pendingProgress)
    },
  }
}

function postError(scope: DedicatedWorkerGlobalScope, requestId: string, error: unknown) {
  scope.postMessage({
    type: 'error',
    requestId,
    error: serializeError(error),
  } satisfies MediaProcessorWorkerResponse)
}

function serializeError(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const name = 'name' in error && typeof error.name === 'string' ? error.name : 'Error'
    const message = 'message' in error && typeof error.message === 'string' ? error.message : String(error)
    return { name, message }
  }
  return { name: 'Error', message: String(error) }
}
