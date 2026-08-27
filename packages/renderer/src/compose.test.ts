import type { IVideoProtocol } from '@video-editor/shared'
import { describe, expect, it, vi } from 'vitest'

const { encoderCalls, rendererCalls } = vi.hoisted(() => ({
  encoderCalls: {
    options: undefined as Record<string, unknown> | undefined,
    addFrame: [] as Array<[number, number]>,
    setAudio: vi.fn(),
    finalize: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  },
  rendererCalls: {
    renderAt: [] as number[],
    destroyed: false,
  },
}))

vi.mock('@video-editor/media', () => ({
  openMediaInput: () => ({
    meta: vi.fn(async () => ({ durationMs: 0 })),
    canDecodeVideo: vi.fn(async () => false),
    canDecodeAudio: vi.fn(async () => false),
    drawFrame: vi.fn(async () => false),
    thumbnails: vi.fn(async () => []),
    decodeAudioSlice: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }),
  createMp4Encoder: (options: Record<string, unknown>) => {
    encoderCalls.options = options
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      }),
      addFrame: vi.fn(async (timestampMs: number, durationMs: number) => {
        encoderCalls.addFrame.push([timestampMs, durationMs])
      }),
      setAudio: encoderCalls.setAudio,
      finalize: encoderCalls.finalize,
      cancel: encoderCalls.cancel,
    }
  },
}))

vi.mock('pixi.js', () => ({
  Application: class {
    canvas = { width: 0, height: 0 }
    ticker = { stop: vi.fn() }
    async init() {}
    destroy() {}
  },
}))

vi.mock('./renderer-core', () => ({
  createRenderer: vi.fn(async () => ({
    duration: { value: 100 },
    renderAt: vi.fn(async (timeMs: number) => {
      rendererCalls.renderAt.push(timeMs)
    }),
    destroy: vi.fn(() => {
      rendererCalls.destroyed = true
    }),
    app: { canvas: {} },
  })),
}))

import { composeProtocol } from './compose'

function createProtocol(): IVideoProtocol {
  return {
    id: 'compose-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [],
  }
}

async function waitForEncoding() {
  for (let i = 0; i < 20; i++)
    await Promise.resolve()
}

describe('composeProtocol', () => {
  it('drives the render loop through the encoder with monotonic progress', async () => {
    encoderCalls.addFrame.length = 0
    rendererCalls.renderAt.length = 0
    const progress: number[] = []

    const result = await composeProtocol(createProtocol(), {
      onProgress: p => progress.push(p),
      audio: false,
    })

    await waitForEncoding()

    // 100ms at 30fps → ceil(3) = 3 frames.
    expect(encoderCalls.addFrame).toHaveLength(3)
    expect(encoderCalls.addFrame[0]?.[0]).toBe(0)
    expect(rendererCalls.renderAt).toHaveLength(3)
    expect(encoderCalls.finalize).toHaveBeenCalledTimes(1)
    expect(encoderCalls.setAudio).not.toHaveBeenCalled()
    expect(progress.at(-1)).toBe(1)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
    expect(result.durationMs).toBe(100)
    expect(rendererCalls.destroyed).toBe(true)
  })

  it('destroy cancels the encoder', async () => {
    encoderCalls.addFrame.length = 0
    encoderCalls.cancel.mockClear()

    const result = await composeProtocol(createProtocol(), { audio: false })
    result.destroy()
    await waitForEncoding()

    expect(encoderCalls.cancel).toHaveBeenCalled()
  })
})
