import type { MediaProcessor } from '../renditions/media-processor'
import type { VideoRenditionProfile } from '../types'
import type { MediaProcessorWorkerRequest, MediaProcessorWorkerResponse } from './protocol'
import { attachMediaProcessorWorker } from './index'

const TEST_PROFILES: readonly VideoRenditionProfile[] = [
  {
    id: 'video-h720-v1',
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    maxShortSide: 720,
    videoBitrate: 2_500_000,
    audioBitrate: 128_000,
    keyFrameIntervalMs: 2_000,
  },
  {
    id: 'video-h360-v1',
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    maxShortSide: 360,
    videoBitrate: 800_000,
    audioBitrate: 96_000,
    keyFrameIntervalMs: 2_000,
  },
]

describe('attachMediaProcessorWorker', () => {
  it('runs a multi-profile processor and posts progress and File results', async () => {
    const scope = new FakeWorkerScope()
    const renditions = [
      { profileId: TEST_PROFILES[0]!.id, file: new File(['720'], '720.mp4', { type: 'video/mp4' }), width: 1280, height: 720 },
      { profileId: TEST_PROFILES[1]!.id, file: new File(['360'], '360.mp4', { type: 'video/mp4' }), width: 640, height: 360 },
    ]
    const processor: MediaProcessor = {
      async process(request) {
        request.onProgress?.({ framesDone: 5, framesTotal: 10, ratio: 0.5, elapsedMs: 30 })
        return renditions
      },
    }
    const detach = attachMediaProcessorWorker(scope as unknown as DedicatedWorkerGlobalScope, processor)

    scope.emit({
      type: 'process',
      requestId: 'request-1',
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      reportProgress: true,
    })

    await vi.waitFor(() => expect(scope.messages).toHaveLength(2))
    expect(scope.messages[0]).toEqual({
      type: 'progress',
      requestId: 'request-1',
      progress: { framesDone: 5, framesTotal: 10, ratio: 0.5, elapsedMs: 30 },
    })
    expect(scope.messages[1]).toEqual({ type: 'result', requestId: 'request-1', renditions })
    detach()
  })

  it('does not create or post progress when the caller has no progress consumer', async () => {
    const scope = new FakeWorkerScope()
    const processor: MediaProcessor = {
      async process(request) {
        expect(request.onProgress).toBeUndefined()
        return []
      },
    }
    const detach = attachMediaProcessorWorker(scope as unknown as DedicatedWorkerGlobalScope, processor)

    scope.emit({
      type: 'process',
      requestId: 'request-without-progress',
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      reportProgress: false,
    })

    await vi.waitFor(() => expect(scope.messages).toHaveLength(1))
    expect(scope.messages).toEqual([{
      type: 'result',
      requestId: 'request-without-progress',
      renditions: [],
    }])
    detach()
  })

  it('throttles requested progress while preserving the first and completed updates', async () => {
    const scope = new FakeWorkerScope()
    const processor: MediaProcessor = {
      async process(request) {
        request.onProgress?.({ framesDone: 1, framesTotal: 100, ratio: 0.01, elapsedMs: 0 })
        request.onProgress?.({ framesDone: 2, framesTotal: 100, ratio: 0.02, elapsedMs: 100 })
        request.onProgress?.({ framesDone: 3, framesTotal: 100, ratio: 0.03, elapsedMs: 249 })
        request.onProgress?.({ framesDone: 4, framesTotal: 100, ratio: 0.04, elapsedMs: 250 })
        request.onProgress?.({ framesDone: 100, framesTotal: 100, ratio: 1, elapsedMs: 251 })
        return []
      },
    }
    const detach = attachMediaProcessorWorker(scope as unknown as DedicatedWorkerGlobalScope, processor)

    scope.emit({
      type: 'process',
      requestId: 'request-with-progress',
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      reportProgress: true,
    })

    await vi.waitFor(() => expect(scope.messages).toHaveLength(4))
    expect(scope.messages).toEqual([
      {
        type: 'progress',
        requestId: 'request-with-progress',
        progress: { framesDone: 1, framesTotal: 100, ratio: 0.01, elapsedMs: 0 },
      },
      {
        type: 'progress',
        requestId: 'request-with-progress',
        progress: { framesDone: 4, framesTotal: 100, ratio: 0.04, elapsedMs: 250 },
      },
      {
        type: 'progress',
        requestId: 'request-with-progress',
        progress: { framesDone: 100, framesTotal: 100, ratio: 1, elapsedMs: 251 },
      },
      { type: 'result', requestId: 'request-with-progress', renditions: [] },
    ])
    detach()
  })

  it('aborts the active processor when cancellation arrives', async () => {
    const scope = new FakeWorkerScope()
    const processor: MediaProcessor = {
      async process(request) {
        return await new Promise((resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            const error = new Error('Processing cancelled.')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    }
    const detach = attachMediaProcessorWorker(scope as unknown as DedicatedWorkerGlobalScope, processor)
    scope.emit({
      type: 'process',
      requestId: 'request-2',
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      reportProgress: false,
    })

    scope.emit({ type: 'cancel', requestId: 'request-2' })

    await vi.waitFor(() => expect(scope.messages).toHaveLength(1))
    expect(scope.messages[0]).toEqual({
      type: 'error',
      requestId: 'request-2',
      error: { name: 'AbortError', message: 'Processing cancelled.' },
    })
    detach()
  })
})

type MessageListener = (event: MessageEvent<MediaProcessorWorkerRequest>) => void

class FakeWorkerScope {
  readonly messages: MediaProcessorWorkerResponse[] = []
  private readonly listeners = new Set<MessageListener>()

  postMessage(message: MediaProcessorWorkerResponse) {
    this.messages.push(message)
  }

  addEventListener(_type: 'message', listener: MessageListener) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: MessageListener) {
    this.listeners.delete(listener)
  }

  emit(message: MediaProcessorWorkerRequest) {
    const event = new MessageEvent('message', { data: message })
    for (const listener of this.listeners)
      listener(event)
  }
}
