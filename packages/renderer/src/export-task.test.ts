import type { IVideoProtocol } from '@video-editor/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { composeCalls } = vi.hoisted(() => ({
  composeCalls: {
    /** Every protocol `composeProtocol` was called with, in order. */
    protocols: [] as IVideoProtocol[],
    signals: [] as (AbortSignal | undefined)[],
    /** Resolves the pending `composeProtocol()` call when set. */
    release: undefined as undefined | (() => void),
    /** Thrown from `composeProtocol()` itself when set. */
    startupError: undefined as undefined | Error,
    /** Rejects the returned `completion` when set. */
    completionError: undefined as undefined | Error,
    chunks: [] as Uint8Array[],
    destroy: vi.fn(),
    progress: [] as number[],
    emitProgress: undefined as undefined | ((value: number) => void),
  },
}))

vi.mock('./compose', () => ({
  composeProtocol: async (protocol: IVideoProtocol, opts: Record<string, any>) => {
    composeCalls.protocols.push(protocol)
    composeCalls.signals.push(opts.signal)
    composeCalls.emitProgress = opts.onProgress

    if (composeCalls.release)
      await new Promise<void>(resolve => composeCalls.release = resolve)
    if (composeCalls.startupError)
      throw composeCalls.startupError

    const chunks = [...composeCalls.chunks]
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks)
            controller.enqueue(chunk)
          controller.close()
        },
      }),
      completion: composeCalls.completionError
        ? Promise.reject(composeCalls.completionError)
        : Promise.resolve(),
      width: 1280,
      height: 720,
      durationMs: 2000,
      mimeType: 'video/mp4',
      fileExtension: '.mp4',
      performance: {
        setupMs: 10,
        audioMs: 20,
        renderMs: 30,
        captureMs: 40,
        encodeWaitMs: 50,
        finalizeMs: 60,
        totalMs: 210,
      },
      destroy: composeCalls.destroy,
    }
  },
}))

const { createExportTask } = await import('./export-task')

function createProtocol(): IVideoProtocol {
  return {
    id: 'export-task-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [],
    transitions: [],
  }
}

function abortError(message = 'cancelled') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

describe('createExportTask', () => {
  beforeEach(() => {
    composeCalls.protocols.length = 0
    composeCalls.signals.length = 0
    composeCalls.chunks = [new Uint8Array([1, 2, 3, 4])]
    composeCalls.release = undefined
    composeCalls.startupError = undefined
    composeCalls.completionError = undefined
    composeCalls.emitProgress = undefined
    composeCalls.destroy.mockClear()
  })

  it('starts pending and reports a result on success', async () => {
    const task = createExportTask(createProtocol(), { audio: false })

    expect(task.state.value.status).toBe('pending')
    expect(task.state.value.progress).toBe(0)
    expect(task.state.value.elapsedMs).toBe(0)
    expect(task.state.value.realtimeFactor).toBe(0)

    await task.start()

    expect(task.state.value.status).toBe('success')
    expect(task.state.value.progress).toBe(1)
    expect(task.state.value.error).toBeUndefined()
    expect(task.state.value.result?.byteLength).toBe(4)
    expect(task.state.value.result?.mimeType).toBe('video/mp4')
    expect(task.state.value.result?.durationMs).toBe(2000)
    expect(task.state.value.result?.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(task.state.value.result?.realtimeFactor).toBeGreaterThanOrEqual(0)
    expect(task.state.value.result?.performance.renderMs).toBe(30)
  })

  it('exports the protocol as it was when the task was created', async () => {
    const protocol = createProtocol()
    const task = createExportTask(protocol, { audio: false })

    // The host's protocol is reactive and keeps changing during an export.
    protocol.width = 640
    protocol.tracks.push({ trackId: 'later', trackType: 'text', children: [] } as never)

    await task.start()

    expect(composeCalls.protocols[0].width).toBe(1280)
    expect(composeCalls.protocols[0].tracks).toHaveLength(0)
  })

  it('reports a failure with a readable error and keeps the task retryable', async () => {
    composeCalls.completionError = new Error('encoder exploded')
    const task = createExportTask(createProtocol(), { audio: false })

    await task.start()

    expect(task.state.value.status).toBe('failed')
    expect(task.state.value.error?.message).toBe('encoder exploded')
    expect(task.state.value.canRetry).toBe(true)
    expect(task.state.value.result).toBeUndefined()
    // The half-written export must let go of its renderer and encoder.
    expect(composeCalls.destroy).toHaveBeenCalled()
  })

  it('retries with the original options, without asking for them again', async () => {
    composeCalls.completionError = new Error('encoder exploded')
    const task = createExportTask(createProtocol(), { audio: false, format: 'webm' })

    await task.start()
    expect(task.state.value.status).toBe('failed')

    composeCalls.completionError = undefined
    await task.retry()

    expect(task.state.value.status).toBe('success')
    expect(task.state.value.error).toBeUndefined()
    expect(composeCalls.protocols).toHaveLength(2)
  })

  it('does not start a second encode while one is running', async () => {
    composeCalls.release = () => {}
    const task = createExportTask(createProtocol(), { audio: false })

    const first = task.start()
    const second = task.start()
    expect(first).toBe(second)

    composeCalls.release?.()
    await first

    expect(composeCalls.protocols).toHaveLength(1)
  })

  it('does not re-run a task that already succeeded', async () => {
    const task = createExportTask(createProtocol(), { audio: false })

    await task.start()
    await task.start()

    expect(composeCalls.protocols).toHaveLength(1)
  })

  it('reports cancellation as its own state rather than a failure', async () => {
    composeCalls.release = () => {}
    const task = createExportTask(createProtocol(), { audio: false })

    const pending = task.start()
    await Promise.resolve()

    task.cancel()
    expect(composeCalls.signals[0]?.aborted).toBe(true)

    composeCalls.startupError = abortError()
    composeCalls.release?.()
    await pending

    expect(task.state.value.status).toBe('cancelled')
    expect(task.state.value.error).toBeUndefined()
    expect(task.state.value.canRetry).toBe(true)
  })

  it('ignores cancel when the task is not running', async () => {
    const task = createExportTask(createProtocol(), { audio: false })

    task.cancel()
    expect(task.state.value.status).toBe('pending')

    await task.start()
    task.cancel()
    expect(task.state.value.status).toBe('success')
  })

  it('forwards progress while running and stops once it is not', async () => {
    const task = createExportTask(createProtocol(), { audio: false })
    composeCalls.release = () => {}

    const pending = task.start()
    await Promise.resolve()
    composeCalls.release?.()
    await pending

    composeCalls.emitProgress?.(0.5)
    // The task finished; a late progress callback must not walk it backwards.
    expect(task.state.value.progress).toBe(1)
  })

  it('reports elapsed time and realtime export speed while running and after success', async () => {
    let now = 100
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now)
    composeCalls.release = () => {}
    const protocol = createProtocol()
    protocol.tracks.push({
      trackId: 'text',
      trackType: 'text',
      children: [{
        id: 'title',
        segmentType: 'text',
        startTime: 0,
        endTime: 2000,
        texts: [],
      }],
    })
    const task = createExportTask(protocol, { audio: false })

    const pending = task.start()
    await Promise.resolve()
    now = 1100
    composeCalls.emitProgress?.(0.5)

    expect(task.state.value.elapsedMs).toBe(1000)
    expect(task.state.value.realtimeFactor).toBe(1)

    composeCalls.release?.()
    now = 2100
    await pending

    expect(task.state.value.result?.elapsedMs).toBe(2000)
    expect(task.state.value.result?.realtimeFactor).toBe(1)
    nowSpy.mockRestore()
  })

  it('streams to a sink instead of collecting a blob', async () => {
    composeCalls.chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]
    const received: number[] = []
    const sink = new WritableStream<Uint8Array>({
      write(chunk) {
        received.push(...chunk)
      },
    })

    const task = createExportTask(createProtocol(), { audio: false, sink })
    await task.start()

    expect(task.state.value.status).toBe('success')
    expect(received).toEqual([1, 2, 3, 4, 5])
    expect(task.state.value.result?.byteLength).toBe(5)
    expect(task.state.value.result?.blob.size).toBe(0)
  })
})
