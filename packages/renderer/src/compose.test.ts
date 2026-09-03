import type { IVideoProtocol } from '@video-editor/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { composeProtocol } from './compose'

const { encoderCalls, opfsState, rendererCalls } = vi.hoisted(() => ({
  encoderCalls: {
    options: undefined as Record<string, unknown> | undefined,
    addFrame: [] as Array<[number, number]>,
    setAudio: vi.fn(),
    finalize: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    unsupportedReason: null as string | null,
    audioInputs: [] as unknown[],
    addFrameImpl: undefined as undefined | ((timestampMs: number, durationMs: number) => Promise<void>),
  },
  rendererCalls: {
    renderAt: [] as number[],
    destroyed: false,
    options: undefined as Record<string, unknown> | undefined,
  },
  opfsState: {
    file: undefined as File | undefined,
    paths: [] as string[],
  },
}))

vi.mock('opfs-tools', () => ({
  file: (path: string) => {
    opfsState.paths.push(path)
    return {
      exists: vi.fn(async () => opfsState.file !== undefined),
      getOriginFile: vi.fn(async () => opfsState.file),
    }
  },
}))

vi.mock('@video-editor/media', () => ({
  checkEncoderSupport: vi.fn(async () => encoderCalls.unsupportedReason),
  openMediaInput: () => ({
    meta: vi.fn(async () => ({ durationMs: 0 })),
    canDecodeVideo: vi.fn(async () => false),
    canDecodeAudio: vi.fn(async () => false),
    drawFrame: vi.fn(async () => false),
    prepareVideoFrameSequence: vi.fn(),
    thumbnails: vi.fn(async () => []),
    decodeAudioSlice: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }),
  createEncoder: (options: Record<string, unknown>) => {
    encoderCalls.options = options
    return {
      mimeType: options.format === 'webm' ? 'video/webm' : 'video/mp4',
      fileExtension: options.format === 'webm' ? '.webm' : '.mp4',
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      }),
      addFrame: vi.fn(async (timestampMs: number, durationMs: number) => {
        encoderCalls.addFrame.push([timestampMs, durationMs])
        await encoderCalls.addFrameImpl?.(timestampMs, durationMs)
      }),
      setAudio: encoderCalls.setAudio,
      finalize: encoderCalls.finalize,
      cancel: encoderCalls.cancel,
      abort: encoderCalls.abort,
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

vi.mock('./timeline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createComposeAudioInputs: vi.fn(() => encoderCalls.audioInputs),
  }
})

vi.mock('./renderer-core', () => ({
  createRenderer: vi.fn(async (options: Record<string, unknown>) => {
    rendererCalls.options = options
    return {
      duration: { value: 100 },
      renderAt: vi.fn(async (timeMs: number) => {
        rendererCalls.renderAt.push(timeMs)
      }),
      destroy: vi.fn(() => {
        rendererCalls.destroyed = true
      }),
      app: { canvas: {} },
    }
  }),
}))

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
  beforeEach(() => {
    opfsState.file = undefined
    opfsState.paths.length = 0
  })

  it('drives the render loop through the encoder with monotonic progress', async () => {
    encoderCalls.addFrame.length = 0
    rendererCalls.renderAt.length = 0
    const progress: number[] = []

    const result = await composeProtocol(createProtocol(), {
      onProgress: p => progress.push(p),
      audio: false,
    })

    await result.completion

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

  it('passes container format and bitrates through to the encoder', async () => {
    const result = await composeProtocol(createProtocol(), {
      audio: false,
      format: 'webm',
      videoCodec: 'vp9',
      bitrate: 4_000_000,
      audioBitrate: 128_000,
    })

    await waitForEncoding()

    expect(encoderCalls.options).toMatchObject({
      format: 'webm',
      videoCodec: 'vp9',
      videoBitrate: 4_000_000,
      audioBitrate: 128_000,
    })
    expect(result.mimeType).toBe('video/webm')
    expect(result.fileExtension).toBe('.webm')
  })

  it('resolves stable asset ids once for both rendering and audio planning', async () => {
    const source = createProtocol()
    source.tracks.push({
      trackId: 'frames-1',
      trackType: 'frames',
      isMain: true,
      children: [{
        id: 'segment-1',
        segmentType: 'frames',
        type: 'image',
        format: 'img',
        assetId: 'asset-1',
        url: 'https://old.example.com/image.png',
        startTime: 0,
        endTime: 100,
      }],
    })
    const resolver = vi.fn(async () => 'https://cdn.example.com/image.png')

    await composeProtocol(source, {
      audio: false,
      clipOptions: { rendererOptions: { resolveAssetUrl: resolver } },
    })

    const rendered = rendererCalls.options?.protocol as IVideoProtocol
    expect(rendered.tracks[0].children[0].url).toBe('https://cdn.example.com/image.png')
    expect(rendererCalls.options).not.toHaveProperty('resolveAssetUrl')
    expect(source.tracks[0].children[0].url).toBe('https://old.example.com/image.png')
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('provides ordered source timestamps for forward video export', async () => {
    const source = createProtocol()
    source.tracks.push({
      trackId: 'frames-1',
      trackType: 'frames',
      isMain: true,
      children: [{
        id: 'video-1',
        segmentType: 'frames',
        type: 'video',
        url: 'https://example.com/video.mp4',
        startTime: 0,
        endTime: 100,
        fromTime: 500,
      }],
    })

    await composeProtocol(source, { audio: false })

    const schedule = rendererCalls.options?.videoFrameSchedule as ReadonlyMap<string, readonly number[]>
    expect(schedule.get('video-1')).toEqual([500, 500 + 1000 / 30, 500 + 2000 / 30])
  })

  it('reports the mp4 container by default', async () => {
    const result = await composeProtocol(createProtocol(), { audio: false })
    await waitForEncoding()

    expect(encoderCalls.options).toMatchObject({ format: undefined })
    expect(result.mimeType).toBe('video/mp4')
    expect(result.fileExtension).toBe('.mp4')
  })

  it('fails before rendering when the browser cannot encode the request', async () => {
    encoderCalls.addFrame.length = 0
    rendererCalls.renderAt.length = 0
    encoderCalls.unsupportedReason = 'this browser cannot encode av1 video at 1280x720'

    await expect(composeProtocol(createProtocol(), { audio: false })).rejects.toThrow('this browser cannot encode av1 video at 1280x720')
    expect(rendererCalls.renderAt).toHaveLength(0)
    expect(encoderCalls.addFrame).toHaveLength(0)

    encoderCalls.unsupportedReason = null
  })

  it('resolves completion once every frame is written', async () => {
    encoderCalls.addFrame.length = 0
    encoderCalls.addFrameImpl = undefined

    const result = await composeProtocol(createProtocol(), { audio: false })

    await expect(result.completion).resolves.toBeUndefined()
    expect(encoderCalls.finalize).toHaveBeenCalled()
  })

  it('propagates a background encoding failure instead of only logging it', async () => {
    encoderCalls.addFrame.length = 0
    encoderCalls.abort.mockClear()
    encoderCalls.addFrameImpl = async (timestampMs) => {
      if (timestampMs > 0)
        throw new Error('encoder exploded')
    }

    const result = await composeProtocol(createProtocol(), { audio: false })

    await expect(result.completion).rejects.toThrow('encoder exploded')
    // The stream must fail too: a consumer reading only the stream would
    // otherwise keep a truncated file and call it a success.
    expect(encoderCalls.abort).toHaveBeenCalled()
    expect(rendererCalls.destroyed).toBe(true)

    encoderCalls.addFrameImpl = undefined
  })

  it('fails the export when a requested audio track cannot be loaded', async () => {
    encoderCalls.audioInputs = [{
      url: 'https://example.com/audio.mp3',
      startTime: 0,
      endTime: 1000,
      fromTime: 0,
    }]
    vi.stubGlobal('OfflineAudioContext', class {
      constructor(..._args: unknown[]) {}
      async startRendering() {
        return {}
      }
    })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    // Silently exporting a soundless video here is the failure mode this guards
    // against: the file plays, so nobody notices until it ships.
    await expect(composeProtocol(createProtocol())).rejects.toThrow(/audio input failed to load/)

    encoderCalls.audioInputs = []
    vi.unstubAllGlobals()
  })

  it('loads export audio from the OPFS cache before trying the network', async () => {
    encoderCalls.audioInputs = [{
      url: 'https://storage.example.com/video.mp4',
      startTime: 0,
      endTime: 1000,
      fromTime: 0,
    }]
    opfsState.file = new File(['cached video'], 'video.mp4', { type: 'video/mp4' })
    vi.stubGlobal('OfflineAudioContext', class {
      constructor(..._args: unknown[]) {}
      async startRendering() {
        return {}
      }
    })
    const fetchMock = vi.fn(async () => new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await composeProtocol(createProtocol(), {
      clipOptions: { rendererOptions: { resourceDir: '/custom-cache' } },
    })

    expect(opfsState.paths).toEqual(['/custom-cache/https/storage.example.com/video.mp4'])
    expect(fetchMock).not.toHaveBeenCalled()

    encoderCalls.audioInputs = []
    vi.unstubAllGlobals()
  })

  it('refuses to start when the signal is already aborted', async () => {
    encoderCalls.addFrame.length = 0
    rendererCalls.renderAt.length = 0
    const controller = new AbortController()
    controller.abort()

    await expect(composeProtocol(createProtocol(), { audio: false, signal: controller.signal }))
      .rejects
      .toMatchObject({ name: 'AbortError' })
    expect(rendererCalls.renderAt).toHaveLength(0)
  })

  it('stops a running encode when the signal aborts', async () => {
    encoderCalls.addFrame.length = 0
    encoderCalls.abort.mockClear()
    encoderCalls.addFrameImpl = undefined
    const controller = new AbortController()

    const result = await composeProtocol(createProtocol(), { audio: false, signal: controller.signal })
    controller.abort()

    await expect(result.completion).rejects.toMatchObject({ name: 'AbortError' })
    expect(encoderCalls.abort).toHaveBeenCalled()
    expect(rendererCalls.destroyed).toBe(true)
  })

  it('destroy aborts the encoder and rejects completion with an AbortError', async () => {
    encoderCalls.addFrame.length = 0
    encoderCalls.abort.mockClear()
    encoderCalls.addFrameImpl = undefined

    const result = await composeProtocol(createProtocol(), { audio: false })
    result.destroy()

    await expect(result.completion).rejects.toMatchObject({ name: 'AbortError' })
    expect(encoderCalls.abort).toHaveBeenCalled()
  })
})
