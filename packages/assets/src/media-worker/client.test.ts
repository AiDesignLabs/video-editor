import type { VideoRenditionProfile } from '../types'
import type { MediaProcessorWorkerRequest, MediaProcessorWorkerResponse } from './protocol'
import { createWorkerMediaProcessor } from './client'

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

describe('createWorkerMediaProcessor', () => {
  it('forwards progress and returns every processed profile', async () => {
    const worker = new FakeWorker()
    const processor = createWorkerMediaProcessor({ createWorker: () => worker as unknown as Worker })
    const progress = vi.fn()
    const resultPromise = processor.process({
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      onProgress: progress,
    })
    const processRequest = worker.messages[0]
    expect(processRequest).toMatchObject({ type: 'process', profiles: TEST_PROFILES, reportProgress: true })
    if (!processRequest || processRequest.type !== 'process')
      throw new Error('Expected a process request.')

    worker.emitMessage({
      type: 'progress',
      requestId: processRequest.requestId,
      progress: { renditionId: 'video-h720-v1', renditionRatio: 0.4, completedRenditions: 0, totalRenditions: 1, ratio: 0.4, elapsedMs: 20 },
    })
    const renditions = [
      { profileId: TEST_PROFILES[0]!.id, file: new File(['720'], '720.mp4', { type: 'video/mp4' }), width: 1280, height: 720 },
      { profileId: TEST_PROFILES[1]!.id, file: new File(['360'], '360.mp4', { type: 'video/mp4' }), width: 640, height: 360 },
    ]
    worker.emitMessage({ type: 'result', requestId: processRequest.requestId, renditions })

    await expect(resultPromise).resolves.toEqual(renditions)
    expect(progress).toHaveBeenCalledWith({ renditionId: 'video-h720-v1', renditionRatio: 0.4, completedRenditions: 0, totalRenditions: 1, ratio: 0.4, elapsedMs: 20 })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('cancels the worker request through AbortSignal', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const processor = createWorkerMediaProcessor({ createWorker: () => worker as unknown as Worker })
    const resultPromise = processor.process({
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      signal: controller.signal,
    })
    const processRequest = worker.messages[0]
    if (!processRequest)
      throw new Error('Expected a process request.')
    expect(processRequest).toMatchObject({ type: 'process', reportProgress: false })

    controller.abort()

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.messages.at(-1)).toEqual({ type: 'cancel', requestId: processRequest.requestId })
    expect(worker.terminate).not.toHaveBeenCalled()

    worker.emitMessage({
      type: 'error',
      requestId: processRequest.requestId,
      error: { name: 'AbortError', message: 'Processing cancelled.' },
    })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('force-terminates a cancelled worker that never acknowledges cleanup', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const controller = new AbortController()
      const processor = createWorkerMediaProcessor({ createWorker: () => worker as unknown as Worker })
      const resultPromise = processor.process({
        source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
        profiles: TEST_PROFILES,
        signal: controller.signal,
      })

      controller.abort()
      await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(worker.terminate).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(10_000)
      expect(worker.terminate).toHaveBeenCalledOnce()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('terminates immediately when cancellation happens during Worker construction', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const processor = createWorkerMediaProcessor({
      createWorker: () => {
        controller.abort()
        return worker as unknown as Worker
      },
    })

    await expect(processor.process({
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.messages).toEqual([])
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('restores worker errors without losing their name', async () => {
    const worker = new FakeWorker()
    const processor = createWorkerMediaProcessor({ createWorker: () => worker as unknown as Worker })
    const resultPromise = processor.process({
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
    })
    const processRequest = worker.messages[0]
    if (!processRequest)
      throw new Error('Expected a process request.')

    worker.emitMessage({
      type: 'error',
      requestId: processRequest.requestId,
      error: { name: 'MediaConversionError', message: 'AVC encoding is unavailable.', code: 'MEDIA_CONVERSION_FAILED', stage: 'initialization', renditionId: 'video-h720-v1' },
    })

    await expect(resultPromise).rejects.toMatchObject({
      name: 'MediaConversionError',
      message: 'AVC encoding is unavailable.',
      code: 'MEDIA_CONVERSION_FAILED',
      stage: 'initialization',
      renditionId: 'video-h720-v1',
    })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('reports Worker construction failure clearly', async () => {
    const processor = createWorkerMediaProcessor({
      createWorker: () => {
        throw new DOMException('Blocked by Content Security Policy', 'SecurityError')
      },
    })

    await expect(processor.process({
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
    })).rejects.toThrow('Media processing worker could not be started: Blocked by Content Security Policy')
  })
})

type WorkerEventType = 'message' | 'messageerror' | 'error'
type WorkerListener = (event: unknown) => void

class FakeWorker {
  readonly messages: MediaProcessorWorkerRequest[] = []
  readonly terminate = vi.fn()
  private readonly listeners: Record<WorkerEventType, Set<WorkerListener>> = {
    message: new Set(),
    messageerror: new Set(),
    error: new Set(),
  }

  postMessage(message: MediaProcessorWorkerRequest) {
    this.messages.push(message)
  }

  addEventListener(type: WorkerEventType, listener: WorkerListener) {
    this.listeners[type].add(listener)
  }

  removeEventListener(type: WorkerEventType, listener: WorkerListener) {
    this.listeners[type].delete(listener)
  }

  emitMessage(message: MediaProcessorWorkerResponse) {
    const event = new MessageEvent('message', { data: message })
    for (const listener of this.listeners.message)
      listener(event)
  }
}
