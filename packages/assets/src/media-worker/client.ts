import type { MediaProcessor } from '../renditions/media-processor'
import type { MediaProcessorWorkerRequest, MediaProcessorWorkerResponse } from './protocol'

export interface WorkerMediaProcessorOptions {
  createWorker: () => Worker
}

let requestSequence = 0
const CANCEL_CLEANUP_GRACE_MS = 10_000

export function createWorkerMediaProcessor(options: WorkerMediaProcessorOptions): MediaProcessor {
  if (typeof options.createWorker !== 'function')
    throw new TypeError('createWorker is required for Worker media processing.')

  return {
    async process(request) {
      if (request.signal?.aborted)
        throw createAbortError()

      let worker: Worker
      try {
        worker = options.createWorker()
      }
      catch (error) {
        throw new Error(`Media processing worker could not be started: ${errorMessage(error)}`, { cause: error })
      }

      const requestId = `media-${Date.now()}-${++requestSequence}`
      return await new Promise((resolve, reject) => {
        let callerSettled = false
        let workerCleaned = false
        let processPosted = false
        let forcedCleanupTimer: ReturnType<typeof setTimeout> | undefined
        let cleanupWorker = () => worker.terminate()
        const settleCaller = (action: () => void) => {
          if (callerSettled)
            return
          callerSettled = true
          action()
        }
        const finish = (action: () => void) => {
          cleanupWorker()
          settleCaller(action)
        }
        const handleAbort = () => {
          if (callerSettled)
            return
          request.signal?.removeEventListener('abort', handleAbort)
          if (!processPosted) {
            cleanupWorker()
            settleCaller(() => reject(createAbortError()))
            return
          }
          try {
            worker.postMessage({ type: 'cancel', requestId } satisfies MediaProcessorWorkerRequest)
            forcedCleanupTimer = setTimeout(cleanupWorker, CANCEL_CLEANUP_GRACE_MS)
          }
          catch {
            cleanupWorker()
          }
          settleCaller(() => reject(createAbortError()))
        }
        const handleMessage = (event: MessageEvent<MediaProcessorWorkerResponse>) => {
          const response = event.data
          if (response.requestId !== requestId)
            return
          if (response.type === 'progress') {
            if (!callerSettled)
              request.onProgress?.(response.progress)
            return
          }
          if (response.type === 'error') {
            finish(() => reject(restoreError(response.error)))
            return
          }
          finish(() => resolve(response.renditions))
        }
        const handleMessageError = () => {
          finish(() => reject(new Error('Media processing worker returned an unreadable message.')))
        }
        const handleWorkerError = (event: ErrorEvent) => {
          finish(() => reject(new Error(`Media processing worker failed: ${event.message || 'unknown worker error'}.`)))
        }
        cleanupWorker = () => {
          if (workerCleaned)
            return
          workerCleaned = true
          if (forcedCleanupTimer !== undefined)
            clearTimeout(forcedCleanupTimer)
          request.signal?.removeEventListener('abort', handleAbort)
          worker.removeEventListener('message', handleMessage)
          worker.removeEventListener('messageerror', handleMessageError)
          worker.removeEventListener('error', handleWorkerError)
          worker.terminate()
        }

        try {
          worker.addEventListener('message', handleMessage)
          worker.addEventListener('messageerror', handleMessageError)
          worker.addEventListener('error', handleWorkerError)
          request.signal?.addEventListener('abort', handleAbort, { once: true })
          if (request.signal?.aborted) {
            handleAbort()
            return
          }
          worker.postMessage({
            type: 'process',
            requestId,
            source: request.source,
            profiles: request.profiles,
            reportProgress: Boolean(request.onProgress),
          } satisfies MediaProcessorWorkerRequest)
          processPosted = true
        }
        catch (error) {
          finish(() => reject(new Error(`Media processing worker could not start the job: ${errorMessage(error)}`, { cause: error })))
        }
      })
    },
  }
}

function createAbortError() {
  const error = new Error('Media processing was cancelled.')
  error.name = 'AbortError'
  return error
}

function restoreError(serialized: { name: string, message: string }) {
  const error = new Error(serialized.message)
  error.name = serialized.name
  return error
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
