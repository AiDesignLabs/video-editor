import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    frames: [] as Array<{ timestampMs: number, durationMs: number }>,
    audio: undefined as AudioBuffer | undefined,
    cancelled: 0,
    controller: undefined as ReadableStreamDefaultController<Uint8Array> | undefined,
    supportError: null as string | null,
    encoderOptions: undefined as Record<string, unknown> | undefined,
  },
}))

vi.mock('./encoder', () => ({
  checkEncoderSupport: async () => state.supportError,
  createEncoder: (options: Record<string, unknown>) => {
    state.encoderOptions = options
    return ({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          state.controller = controller
        },
      }),
      mimeType: 'video/mp4',
      fileExtension: '.mp4',
      getWriteStats: () => ({ chunks: 1, ms: 2 }),
      async addFrame(timestampMs: number, durationMs: number) {
        state.frames.push({ timestampMs, durationMs })
        return { captureMs: 0, submitMs: 0 }
      },
      async setAudio(buffer: AudioBuffer) {
        state.audio = buffer
      },
      async finalize() {
        state.controller?.enqueue(new Uint8Array([1, 2, 3]))
        state.controller?.close()
      },
      async cancel() {
        state.cancelled += 1
        try {
          state.controller?.close()
        }
        catch {}
      },
    })
  },
}))

const { renderCanvasToVideo } = await import('./render-canvas-to-video')

function fakeCanvas() {
  return { width: 1920, height: 1080 } as HTMLCanvasElement
}

function createSink() {
  const chunks: Uint8Array[] = []
  return {
    chunks,
    stream: new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
    }),
  }
}

function createFailingSink() {
  return new WritableStream<Uint8Array>({
    write() {
      throw new Error('sink write failed')
    },
  })
}

beforeEach(() => {
  state.frames = []
  state.audio = undefined
  state.cancelled = 0
  state.controller = undefined
  state.supportError = null
  state.encoderOptions = undefined
})

describe('renderCanvasToVideo', () => {
  it('renders exact media times and shortens the final frame to the requested duration', async () => {
    const sink = createSink()
    const rendered: Array<{ frameIndex: number, timeMs: number, durationMs: number }> = []
    const progress = vi.fn()

    const result = await renderCanvasToVideo({
      canvas: fakeCanvas(),
      durationMs: 100,
      fps: 24,
      sink: sink.stream,
      renderFrame(frame) {
        rendered.push(frame)
      },
      onProgress: progress,
    })

    expect(rendered).toHaveLength(3)
    expect(rendered.map(frame => frame.frameIndex)).toEqual([0, 1, 2])
    expect(rendered[0]!.timeMs).toBe(0)
    expect(rendered[1]!.timeMs).toBeCloseTo(1000 / 24)
    expect(rendered[2]!.durationMs).toBeCloseTo(100 - 2000 / 24)
    expect(state.frames).toEqual(rendered.map(({ timeMs, durationMs }) => ({ timestampMs: timeMs, durationMs })))
    expect(progress).toHaveBeenLastCalledWith({ framesDone: 3, framesTotal: 3, timeMs: 100 })
    expect(sink.chunks).toEqual([new Uint8Array([1, 2, 3])])
    expect(result).toMatchObject({ frameCount: 3, durationMs: 100, mimeType: 'video/mp4' })
    expect(state.encoderOptions).toMatchObject({ frameRate: 24 })
  })

  it('passes optional audio to the encoder', async () => {
    const audio = {} as AudioBuffer
    await renderCanvasToVideo({
      canvas: fakeCanvas(),
      durationMs: 40,
      fps: 25,
      sink: createSink().stream,
      renderFrame: () => {},
      audio,
    })
    expect(state.audio).toBe(audio)
  })

  it('cancels the encoder and rejects with AbortError', async () => {
    const controller = new AbortController()
    await expect(renderCanvasToVideo({
      canvas: fakeCanvas(),
      durationMs: 100,
      fps: 25,
      sink: createSink().stream,
      signal: controller.signal,
      renderFrame: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.frames).toHaveLength(0)
    expect(state.cancelled).toBeGreaterThan(0)
  })

  it('cancels the encoder when rendering or writing output fails', async () => {
    await expect(renderCanvasToVideo({
      canvas: fakeCanvas(),
      durationMs: 100,
      fps: 25,
      sink: createSink().stream,
      renderFrame: () => { throw new Error('render failed') },
    })).rejects.toThrow('render failed')
    expect(state.cancelled).toBeGreaterThan(0)

    state.cancelled = 0
    await expect(renderCanvasToVideo({
      canvas: fakeCanvas(),
      durationMs: 100,
      fps: 25,
      sink: createFailingSink(),
      renderFrame: () => {},
    })).rejects.toThrow('sink write failed')
    expect(state.cancelled).toBeGreaterThan(0)
  })

  it('rejects invalid timing and canvas dimensions before creating output', async () => {
    await expect(renderCanvasToVideo({
      canvas: fakeCanvas(),
      durationMs: 0,
      fps: 25,
      sink: createSink().stream,
      renderFrame: () => {},
    })).rejects.toThrow(/durationMs/)
    await expect(renderCanvasToVideo({
      canvas: { width: 0, height: 10 } as HTMLCanvasElement,
      durationMs: 100,
      fps: 25,
      sink: createSink().stream,
      renderFrame: () => {},
    })).rejects.toThrow(/canvas dimensions/)
  })

  it('fails before rendering or locking the sink when the encoder is unsupported', async () => {
    state.supportError = 'this browser cannot encode avc video at 1920x1080'
    const sink = createSink()
    const renderFrame = vi.fn()

    await expect(renderCanvasToVideo({
      canvas: fakeCanvas(),
      durationMs: 100,
      fps: 25,
      sink: sink.stream,
      renderFrame,
    })).rejects.toThrow(/cannot encode avc video/)

    expect(renderFrame).not.toHaveBeenCalled()
    expect(sink.stream.locked).toBe(false)
    expect(state.encoderOptions).toBeUndefined()
  })
})
