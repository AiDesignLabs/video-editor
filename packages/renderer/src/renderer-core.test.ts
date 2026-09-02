/// <reference types="vitest" />

import type {
  IAudioSegment,
  IEffectSegment,
  IFilterSegment,
  IImageFramesSegment,
  IStickerSegment,
  ITextSegment,
  IVideoFramesSegment,
  IVideoProtocol,
  TrackUnion,
} from '@video-editor/shared'
import { ref } from '@vue/reactivity'
import { describe, expect, it, vi } from 'vitest'
import { createRenderer } from './renderer-core'

const { audioManagerInstances, mediaInputHandles, mediaMockState, opfsState } = vi.hoisted(() => ({
  mediaMockState: {
    openError: false,
    drawFrameErrorName: undefined as string | undefined,
  },
  audioManagerInstances: [] as Array<{
    protocol: IVideoProtocol
    options?: {
      resolveMediaElementUrl?: (segment: IAudioSegment | IVideoFramesSegment) => string | undefined
    }
    setProtocol: ReturnType<typeof vi.fn>
    applyTimelinePlan: ReturnType<typeof vi.fn>
    resetTimelineState: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>,
  mediaInputHandles: [] as Array<{
    source: unknown
    meta: ReturnType<typeof vi.fn>
    canDecodeVideo: ReturnType<typeof vi.fn>
    canDecodeAudio: ReturnType<typeof vi.fn>
    drawFrame: ReturnType<typeof vi.fn>
    thumbnails: ReturnType<typeof vi.fn>
    decodeAudioSlice: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
  opfsState: {
    exists: false,
    originFile: undefined as File | undefined,
  },
}))

vi.mock('@video-editor/protocol', () => ({
  createValidator: () => ({
    verify: (protocol: IVideoProtocol) => protocol,
  }),
  createResourceManager: () => ({
    add: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
  }),
  getResourceKey: (url: string) => url,
}))

vi.mock('@video-editor/media', () => ({
  openMediaInput: (source: unknown) => {
    if (mediaMockState.openError)
      throw new Error('mock media open failure')
    const handle = {
      source,
      meta: vi.fn(async () => ({
        durationMs: 1000,
        width: 640,
        height: 360,
        audioSampleRate: 48000,
        audioChanCount: 2,
        hasVideo: true,
        hasAudio: true,
      })),
      canDecodeVideo: vi.fn(async () => true),
      canDecodeAudio: vi.fn(async () => true),
      drawFrame: vi.fn(async () => {
        if (mediaMockState.drawFrameErrorName) {
          const err = new Error('mock draw frame failure')
          err.name = mediaMockState.drawFrameErrorName
          throw err
        }
        return true
      }),
      thumbnails: vi.fn(async () => []),
      decodeAudioSlice: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    mediaInputHandles.push(handle)
    return handle
  },
}))

vi.mock('opfs-tools', () => ({
  file: vi.fn(() => ({
    exists: vi.fn(async () => opfsState.exists),
    getOriginFile: vi.fn(async () => opfsState.originFile),
  })),
}))

vi.mock('pixi.js', async () => {
  const { MockBlurFilter: BlurFilter, MockColorMatrixFilter: ColorMatrixFilter, MockFilter: Filter, MOCK_DEFAULT_FILTER_VERT: defaultFilterVert } = await import('../test/pixi-mock')

  class Container {
    public children: unknown[] = []

    addChild(...items: unknown[]) {
      this.children.push(...items)
      return items[0]
    }

    removeChildren() {
      const removed = this.children
      this.children = []
      return removed
    }

    destroy() {
      this.children = []
    }
  }

  class Graphics {
    public destroyed = false
    rect() { return this }
    fill() { return this }
    clear() { return this }
    pivot = { set: vi.fn() }
    position = { set: vi.fn() }
    rotation = 0
    alpha = 1
    destroy() {
      this.destroyed = true
    }
  }

  class Sprite {
    public destroyed = false
    public texture: unknown
    public anchor = { set: vi.fn() }
    public position = { set: vi.fn() }
    public scale = { set: vi.fn() }
    public rotation = 0
    public alpha = 1
    public width = 0
    public height = 0

    constructor(texture?: unknown) {
      this.texture = texture
    }

    destroy() {
      this.destroyed = true
    }
  }

  class Texture {
    public source = { update: vi.fn() }

    constructor(_options?: unknown) {}

    static from() {
      return new Texture()
    }

    update() {}

    destroy() {}
  }

  class ImageSource {
    constructor(public options?: unknown) {}
  }

  return { BlurFilter, ColorMatrixFilter, Container, defaultFilterVert, Filter, Graphics, ImageSource, Sprite, Texture }
})

vi.mock('./audio-manager', () => {
  class AudioManager {
    public protocol: IVideoProtocol
    public options?: {
      resolveMediaElementUrl?: (segment: IAudioSegment | IVideoFramesSegment) => string | undefined
    }

    public setProtocol = vi.fn((protocol: IVideoProtocol) => {
      this.protocol = protocol
    })

    public applyTimelinePlan = vi.fn()
    public resetTimelineState = vi.fn()
    public destroy = vi.fn()

    constructor(
      protocol: IVideoProtocol,
      options?: {
        resolveMediaElementUrl?: (segment: IAudioSegment | IVideoFramesSegment) => string | undefined
      },
    ) {
      this.protocol = protocol
      this.options = options
      audioManagerInstances.push(this)
    }
  }

  return { AudioManager }
})

function createAudioSegment(id: string, startTime: number, endTime: number): IAudioSegment {
  return {
    id,
    segmentType: 'audio',
    url: `https://example.com/${id}.mp3`,
    startTime,
    endTime,
  }
}

function createFrameSegment(id: string, startTime: number, endTime: number): IImageFramesSegment {
  return {
    id,
    segmentType: 'frames',
    type: 'image',
    format: 'img',
    url: `https://example.com/${id}.png`,
    startTime,
    endTime,
  }
}

function createVideoSegment(id: string, startTime: number, endTime: number): IVideoFramesSegment {
  return {
    id,
    segmentType: 'frames',
    type: 'video',
    url: `https://example.com/${id}.mp4`,
    startTime,
    endTime,
    fromTime: 0,
  }
}

function createTextSegment(id: string, startTime: number, endTime: number, content = id): ITextSegment {
  return {
    id,
    segmentType: 'text',
    startTime,
    endTime,
    texts: [{ content }],
  }
}

function createStickerSegment(id: string, startTime: number, endTime: number): IStickerSegment {
  return {
    id,
    segmentType: 'sticker',
    format: 'img',
    url: `https://example.com/${id}.png`,
    startTime,
    endTime,
  }
}

function createEffectSegment(id: string, startTime: number, endTime: number, name = id): IEffectSegment {
  return {
    id,
    segmentType: 'effect',
    effectId: `effect-${id}`,
    name,
    startTime,
    endTime,
  }
}

function createFilterSegment(id: string, startTime: number, endTime: number, intensity = 0.5): IFilterSegment {
  return {
    id,
    segmentType: 'filter',
    filterId: `filter-${id}`,
    name: id,
    intensity,
    startTime,
    endTime,
  }
}

function createProtocol(segments: IAudioSegment[]): IVideoProtocol {
  return {
    id: 'renderer-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: segments,
      },
    ],
  }
}

function createMockApp() {
  return {
    stage: { addChild: vi.fn() },
    renderer: { width: 1280, height: 720 },
    ticker: { stop: vi.fn() },
    render: vi.fn(),
  }
}

function stubVideoRenderGlobals(options?: { pendingFetchUrls?: Set<string>, failedFetchUrls?: Set<string> }) {
  const originalDocument = globalThis.document
  const originalFetch = globalThis.fetch

  const drawImage = vi.fn()
  const createElement = vi.fn((tagName: string) => {
    if (tagName === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
      }
    }
    throw new Error(`Unexpected element: ${tagName}`)
  })

  ;(globalThis as unknown as { document: Pick<Document, 'createElement'> }).document = { createElement } as unknown as Pick<Document, 'createElement'>
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (options?.pendingFetchUrls?.has(url))
      return new Promise<Response>(() => {})

    if (options?.failedFetchUrls?.has(url)) {
      return Promise.resolve({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        blob: vi.fn(async () => new Blob()),
      } as unknown as Response)
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      }),
      blob: async () => new Blob(),
    } as unknown as Response)
  })
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

  return {
    createElement,
    fetchMock,
    restore: () => {
      ;(globalThis as unknown as { document: typeof originalDocument }).document = originalDocument
      ;(globalThis as unknown as { fetch: typeof originalFetch }).fetch = originalFetch
    },
  }
}

function stubAnimationFrame() {
  const originalRaf = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const requestAnimationFrame = vi.fn(() => 1)
  const cancelAnimationFrame = vi.fn()
  ;(globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = requestAnimationFrame
  ;(globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = cancelAnimationFrame
  return () => {
    ;(globalThis as unknown as { requestAnimationFrame: typeof originalRaf }).requestAnimationFrame = originalRaf
    ;(globalThis as unknown as { cancelAnimationFrame: typeof originalCancel }).cancelAnimationFrame = originalCancel
  }
}

function getTrack<T extends TrackUnion['trackType']>(
  protocol: IVideoProtocol,
  trackId: string,
  trackType: T,
): Extract<TrackUnion, { trackType: T }> {
  const track = protocol.tracks.find(item => item.trackId === trackId && item.trackType === trackType)
  if (!track)
    throw new Error(`track not found: ${trackId} (${trackType})`)
  return track as Extract<TrackUnion, { trackType: T }>
}

function getAudioManagerInstance() {
  const audioManager = audioManagerInstances[0]
  expect(audioManager).toBeDefined()
  return audioManager!
}

function getLatestSyncedProtocol() {
  const audioManager = getAudioManagerInstance()
  const latest = audioManager.setProtocol.mock.calls.at(-1)?.[0] as IVideoProtocol | undefined
  expect(latest).toBeDefined()
  return latest!
}

async function flushReactivity() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createRenderer render ownership', () => {
  it('stops the Pixi application ticker before managing the stage', async () => {
    audioManagerInstances.length = 0
    const app = createMockApp()
    const renderer = await createRenderer({
      protocol: createProtocol([]),
      app: app as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      expect(app.ticker.stop).toHaveBeenCalledTimes(1)
    }
    finally {
      renderer.destroy()
    }
  })

  it('refreshes stable asset mappings without changing the protocol', async () => {
    const segment = createFrameSegment('image-1', 0, 1000)
    segment.assetId = 'asset-1'
    const resolveAssetUrl = vi.fn(async () => 'https://cdn.example.com/image-1.png')
    const protocol: IVideoProtocol = {
      id: 'renderer-asset-test',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [{
        trackId: 'frames-track',
        trackType: 'frames',
        isMain: true,
        children: [segment],
      }],
    }
    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as unknown as Parameters<typeof createRenderer>[0]['app'],
      manualRender: true,
      warmUpResources: false,
      resolveAssetUrl,
    })

    try {
      await flushReactivity()
      const callsBeforeRefresh = resolveAssetUrl.mock.calls.length
      await renderer.refreshAssets()
      expect(resolveAssetUrl).toHaveBeenCalledTimes(callsBeforeRefresh + 2)
    }
    finally {
      renderer.destroy()
    }
  })

  it('uses the preview source for visuals and the original source for audio', async () => {
    audioManagerInstances.length = 0
    const segment = createVideoSegment('video-1', 0, 1000)
    segment.assetId = 'asset-1'
    const protocol: IVideoProtocol = {
      id: 'renderer-proxy-audio-test',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [{
        trackId: 'frames-track',
        trackType: 'frames',
        isMain: true,
        children: [segment],
      }],
    }
    const resolveAssetUrl = vi.fn(async (
      _assetId: string,
      fallbackUrl: string,
      context?: { media: 'visual' | 'audio' },
    ) => context?.media === 'visual' ? 'local-asset://proxy/video.mp4' : fallbackUrl)

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as unknown as Parameters<typeof createRenderer>[0]['app'],
      manualRender: true,
      warmUpResources: false,
      resolveAssetUrl,
    })

    try {
      const contexts = resolveAssetUrl.mock.calls.map(call => call[2])
      expect(contexts.filter(context => context?.media === 'visual')).toHaveLength(2)
      expect(contexts.filter(context => context?.media === 'audio')).toHaveLength(2)
      const audioSegment = getAudioManagerInstance().protocol.tracks[0]!.children[0]
      expect(audioSegment.url).toBe(segment.url)
    }
    finally {
      renderer.destroy()
    }
  })
})

describe('createRenderer video segment preloading', () => {
  it('resolves video segment audio from an OPFS object URL', async () => {
    audioManagerInstances.length = 0
    opfsState.exists = true
    opfsState.originFile = { name: 'video-1.mp4' } as File
    const createObjectURL = vi.fn(() => 'blob:opfs-video-1')
    const revokeObjectURL = vi.fn()
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-video-audio-opfs',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [
            createVideoSegment('video-1', 0, 1000),
          ],
        },
      ],
    })
    const videoSegment = protocol.value.tracks[0]!.children[0] as IVideoFramesSegment
    videoSegment.url = 'local-asset://video-1/video-1.mp4'

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as unknown as Parameters<typeof createRenderer>[0]['app'],
      manualRender: true,
    })

    try {
      const audioManager = getAudioManagerInstance()
      expect(audioManager.options?.resolveMediaElementUrl?.(videoSegment)).toBe('blob:opfs-video-1')
      expect(createObjectURL).toHaveBeenCalledWith(opfsState.originFile)
    }
    finally {
      renderer.destroy()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:opfs-video-1')
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      opfsState.exists = false
      opfsState.originFile = undefined
    }
  })

  it('opens the decoder for preview visuals without decoding video segment audio', async () => {
    audioManagerInstances.length = 0
    mediaInputHandles.length = 0
    const { restore } = stubVideoRenderGlobals()
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-video-visual-only',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [
            createVideoSegment('video-1', 0, 1000),
          ],
        },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
      videoSourceMode: 'auto',
    })

    try {
      await renderer.renderAt(100)

      expect(mediaInputHandles[0]?.drawFrame).toHaveBeenCalled()
      expect(mediaInputHandles[0]?.decodeAudioSlice).not.toHaveBeenCalled()
    }
    finally {
      restore()
      renderer.destroy()
    }
  })

  it('does not fall back to a video element when a decoder task was disposed', async () => {
    audioManagerInstances.length = 0
    mediaInputHandles.length = 0
    mediaMockState.drawFrameErrorName = 'InputDisposedError'
    const { createElement, restore } = stubVideoRenderGlobals()
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-disposed-decoder',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [createVideoSegment('video-1', 0, 1000)],
        },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
      videoSourceMode: 'auto',
    })

    try {
      await renderer.renderAt(100)

      expect(mediaInputHandles[0]?.dispose).toHaveBeenCalledTimes(1)
      expect(createElement.mock.calls.some(([tagName]) => tagName === 'video')).toBe(false)

      mediaMockState.drawFrameErrorName = undefined
      await renderer.renderAt(150)
      expect(mediaInputHandles).toHaveLength(2)
      expect(mediaInputHandles[1]?.drawFrame).toHaveBeenCalled()
    }
    finally {
      mediaMockState.drawFrameErrorName = undefined
      restore()
      renderer.destroy()
    }
  })

  it('does not parse or fall back for an HTTP error response', async () => {
    audioManagerInstances.length = 0
    mediaInputHandles.length = 0
    const videoUrl = 'https://example.com/video-1.mp4'
    const { createElement, restore } = stubVideoRenderGlobals({ failedFetchUrls: new Set([videoUrl]) })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-http-media-error',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [createVideoSegment('video-1', 0, 1000)],
        },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
      videoSourceMode: 'auto',
    })

    try {
      await renderer.renderAt(100)

      expect(mediaInputHandles).toHaveLength(0)
      expect(createElement.mock.calls.some(([tagName]) => tagName === 'video')).toBe(false)
      expect(errorSpy).toHaveBeenCalledWith(
        '[renderer] failed to load video via decoder',
        videoUrl,
        expect.objectContaining({ name: 'MediaResourceHttpError', status: 403 }),
      )
    }
    finally {
      errorSpy.mockRestore()
      restore()
      renderer.destroy()
    }
  })

  it('loads and draws the first frame of the next video segment before it becomes active', async () => {
    audioManagerInstances.length = 0
    mediaInputHandles.length = 0
    const { restore } = stubVideoRenderGlobals()
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-video-preload',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [
            createVideoSegment('video-1', 0, 1000),
            createVideoSegment('video-2', 1000, 2000),
          ],
        },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
      videoSourceMode: 'auto',
    })

    try {
      await renderer.renderAt(800)
      await flushReactivity()

      expect(mediaInputHandles).toHaveLength(2)
      expect(mediaInputHandles.some(instance => instance.drawFrame.mock.calls.some(([, time]) => time === 0))).toBe(true)
    }
    finally {
      restore()
      renderer.destroy()
    }
  })

  it('does not start video preloading before the next segment is close enough', async () => {
    audioManagerInstances.length = 0
    mediaInputHandles.length = 0
    const { restore } = stubVideoRenderGlobals()
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-video-preload-window',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [
            createVideoSegment('video-1', 0, 5000),
            createVideoSegment('video-2', 5000, 9000),
          ],
        },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
      videoSourceMode: 'auto',
    })

    try {
      await renderer.renderAt(1000)
      await flushReactivity()

      expect(mediaInputHandles).toHaveLength(1)
      await renderer.renderAt(3600)
      await flushReactivity()
      expect(mediaInputHandles).toHaveLength(2)
    }
    finally {
      restore()
      renderer.destroy()
    }
  })

  it('keeps repeated render passes from starting more preloads than the in-flight limit', async () => {
    audioManagerInstances.length = 0
    mediaInputHandles.length = 0
    const pendingFetchUrls = new Set([
      'https://example.com/video-2.mp4',
      'https://example.com/video-3.mp4',
      'https://example.com/video-4.mp4',
      'https://example.com/video-5.mp4',
    ])
    const { fetchMock, restore } = stubVideoRenderGlobals({ pendingFetchUrls })
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-video-preload-concurrency',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [
            createVideoSegment('video-1', 0, 1000),
            createVideoSegment('video-2', 1000, 2000),
            createVideoSegment('video-3', 1100, 2100),
            createVideoSegment('video-4', 1200, 2200),
            createVideoSegment('video-5', 1300, 2300),
          ],
        },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
      videoSourceMode: 'auto',
    })

    try {
      await renderer.renderAt(0)
      await flushReactivity()
      await renderer.renderAt(100)
      await flushReactivity()

      const fetchedUrls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(fetchedUrls).toEqual([
        'https://example.com/video-2.mp4',
        'https://example.com/video-3.mp4',
        'https://example.com/video-1.mp4',
      ])
    }
    finally {
      restore()
      renderer.destroy()
    }
  })
})

describe('createRenderer protocol sync', () => {
  it('updates AudioManager with latest protocol after deep mutation', async () => {
    audioManagerInstances.length = 0

    const protocol = ref(createProtocol([
      createAudioSegment('audio-1', 0, 1000),
      createAudioSegment('audio-2', 1000, 2000),
    ]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = audioManagerInstances[0]
      expect(audioManager).toBeDefined()
      expect(audioManager.setProtocol).toHaveBeenCalledTimes(1)

      protocol.value.tracks[0]!.children.splice(0, 1)
      await flushReactivity()

      expect(audioManager.setProtocol.mock.calls.length).toBeGreaterThanOrEqual(2)
      const latestProtocol = audioManager.setProtocol.mock.calls.at(-1)?.[0] as IVideoProtocol
      const latestIds = latestProtocol.tracks[0]!.children.map(segment => segment.id)
      expect(latestIds).toEqual(['audio-2'])
      expect(latestProtocol).not.toBe(protocol.value)
    }
    finally {
      renderer.destroy()
    }
  })

  it('updates AudioManager when protocol ref value is replaced', async () => {
    audioManagerInstances.length = 0

    const protocol = ref(createProtocol([
      createAudioSegment('audio-1', 0, 1000),
      createAudioSegment('audio-2', 1000, 2000),
    ]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = audioManagerInstances[0]
      expect(audioManager).toBeDefined()

      protocol.value = createProtocol([createAudioSegment('audio-2', 1000, 2000)])
      await flushReactivity()

      const latestProtocol = audioManager.setProtocol.mock.calls.at(-1)?.[0] as IVideoProtocol
      const latestIds = latestProtocol.tracks[0]!.children.map(segment => segment.id)
      expect(latestIds).toEqual(['audio-2'])
    }
    finally {
      renderer.destroy()
    }
  })
})

describe('createRenderer audio scheduler', () => {
  it('uses plan path when rendering at a paused timeline', async () => {
    audioManagerInstances.length = 0
    const protocol = ref(createProtocol([createAudioSegment('audio-1', 0, 1000)]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      await renderer.renderAt(100)
      const audioManager = getAudioManagerInstance()
      expect(audioManager.applyTimelinePlan).toHaveBeenCalledTimes(1)
      const [plan, isPlaying] = audioManager.applyTimelinePlan.mock.calls[0] ?? []
      expect(typeof plan).toBe('object')
      expect(isPlaying).toBe(false)
    }
    finally {
      renderer.destroy()
    }
  })

  it('resets timeline state with hard stop on seek', async () => {
    audioManagerInstances.length = 0
    const protocol = ref(createProtocol([createAudioSegment('audio-1', 0, 1000)]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = getAudioManagerInstance()
      audioManager.resetTimelineState.mockClear()
      renderer.seek(500)
      expect(audioManager.resetTimelineState).toHaveBeenCalledTimes(1)
      expect(audioManager.resetTimelineState).toHaveBeenCalledWith({ stop: true })
    }
    finally {
      renderer.destroy()
    }
  })

  it('starts ticker on play and emits non-dry-run plan', async () => {
    audioManagerInstances.length = 0
    const restoreAnimationFrame = stubAnimationFrame()
    const protocol = ref(createProtocol([createAudioSegment('audio-1', 0, 1000)]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = getAudioManagerInstance()
      audioManager.applyTimelinePlan.mockClear()
      renderer.play()
      expect(audioManager.applyTimelinePlan).toHaveBeenCalledTimes(1)
      const [plan, isPlaying] = audioManager.applyTimelinePlan.mock.calls[0] ?? []
      expect(typeof plan).toBe('object')
      expect(isPlaying).toBe(true)
      renderer.pause()
    }
    finally {
      restoreAnimationFrame()
      renderer.destroy()
    }
  })

  it('resets timeline state on pause', async () => {
    audioManagerInstances.length = 0
    const restoreAnimationFrame = stubAnimationFrame()
    const protocol = ref(createProtocol([createAudioSegment('audio-1', 0, 1000)]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = getAudioManagerInstance()
      renderer.play()
      audioManager.resetTimelineState.mockClear()
      renderer.pause()
      expect(audioManager.resetTimelineState).toHaveBeenCalledTimes(1)
      expect(audioManager.resetTimelineState).toHaveBeenCalledWith({ stop: true })
    }
    finally {
      restoreAnimationFrame()
      renderer.destroy()
    }
  })
})

describe('createRenderer segment operations across types', () => {
  it('syncs add/update/remove operations for frames/text/sticker/effect/filter/audio', async () => {
    audioManagerInstances.length = 0

    const protocol = ref<IVideoProtocol>({
      id: 'renderer-segment-ops',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        { trackId: 'frames-track', trackType: 'frames', isMain: true, children: [createFrameSegment('frame-1', 0, 1000)] },
        { trackId: 'text-track', trackType: 'text', children: [createTextSegment('text-1', 0, 1000, 'hello')] },
        { trackId: 'sticker-track', trackType: 'sticker', children: [createStickerSegment('sticker-1', 0, 800)] },
        { trackId: 'audio-track', trackType: 'audio', children: [createAudioSegment('audio-1', 0, 1200)] },
        { trackId: 'effect-track', trackType: 'effect', children: [createEffectSegment('effect-1', 0, 1200, 'fx-a')] },
        { trackId: 'filter-track', trackType: 'filter', children: [createFilterSegment('filter-1', 0, 1200, 0.4)] },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = getAudioManagerInstance()
      expect(audioManager.setProtocol).toHaveBeenCalledTimes(1)

      // frames: update (resize)
      const frame = getTrack(protocol.value, 'frames-track', 'frames').children[0] as IImageFramesSegment
      frame.startTime = 120
      frame.endTime = 980
      await flushReactivity()
      let latest = getLatestSyncedProtocol()
      const latestFrame = getTrack(latest, 'frames-track', 'frames').children[0] as IImageFramesSegment
      expect(latestFrame.startTime).toBe(120)
      expect(latestFrame.endTime).toBe(980)

      // text: update content + add segment
      const textTrack = getTrack(protocol.value, 'text-track', 'text')
      const text1 = textTrack.children[0] as ITextSegment
      text1.texts[0]!.content = 'world'
      textTrack.children.push(createTextSegment('text-2', 1000, 1800, 'new'))
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      const latestTextTrack = getTrack(latest, 'text-track', 'text')
      const latestText1 = latestTextTrack.children.find(item => item.id === 'text-1') as ITextSegment | undefined
      expect(latestText1?.texts[0]?.content).toBe('world')
      expect(latestTextTrack.children.map(item => item.id)).toEqual(['text-1', 'text-2'])

      // sticker: remove
      const stickerTrack = getTrack(protocol.value, 'sticker-track', 'sticker')
      stickerTrack.children.splice(0, 1)
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      expect(getTrack(latest, 'sticker-track', 'sticker').children).toHaveLength(0)

      // audio: remove + add
      const audioTrack = getTrack(protocol.value, 'audio-track', 'audio')
      audioTrack.children.splice(0, 1)
      audioTrack.children.push(createAudioSegment('audio-2', 200, 1000))
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      expect(getTrack(latest, 'audio-track', 'audio').children.map(item => item.id)).toEqual(['audio-2'])

      // effect: update name
      const effect = getTrack(protocol.value, 'effect-track', 'effect').children[0] as IEffectSegment
      effect.name = 'fx-b'
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      const latestEffect = getTrack(latest, 'effect-track', 'effect').children[0] as IEffectSegment
      expect(latestEffect.name).toBe('fx-b')

      // filter: add + update intensity
      const filterTrack = getTrack(protocol.value, 'filter-track', 'filter')
      const filter1 = filterTrack.children[0] as IFilterSegment
      filter1.intensity = 0.8
      filterTrack.children.push(createFilterSegment('filter-2', 1200, 2000, 0.3))
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      const latestFilterTrack = getTrack(latest, 'filter-track', 'filter')
      const latestFilter1 = latestFilterTrack.children.find(item => item.id === 'filter-1') as IFilterSegment | undefined
      expect(latestFilter1?.intensity).toBe(0.8)
      expect(latestFilterTrack.children.map(item => item.id)).toEqual(['filter-1', 'filter-2'])
    }
    finally {
      renderer.destroy()
    }
  })

  it('syncs segment move across tracks', async () => {
    audioManagerInstances.length = 0

    const protocol = ref<IVideoProtocol>({
      id: 'renderer-segment-move',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        { trackId: 'text-track-a', trackType: 'text', children: [createTextSegment('text-1', 0, 1000, 'a')] },
        { trackId: 'text-track-b', trackType: 'text', children: [createTextSegment('text-2', 1000, 1800, 'b')] },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const fromTrack = getTrack(protocol.value, 'text-track-a', 'text')
      const targetTrack = getTrack(protocol.value, 'text-track-b', 'text')
      const moving = fromTrack.children.splice(0, 1)[0] as ITextSegment | undefined
      expect(moving).toBeDefined()
      moving!.startTime = 1800
      moving!.endTime = 2400
      targetTrack.children.push(moving!)

      await flushReactivity()

      const latest = getLatestSyncedProtocol()
      expect(getTrack(latest, 'text-track-a', 'text').children.map(item => item.id)).toEqual([])
      const latestTarget = getTrack(latest, 'text-track-b', 'text').children
      expect(latestTarget.map(item => item.id)).toEqual(['text-2', 'text-1'])
      const moved = latestTarget.find(item => item.id === 'text-1') as ITextSegment | undefined
      expect(moved?.startTime).toBe(1800)
      expect(moved?.endTime).toBe(2400)
    }
    finally {
      renderer.destroy()
    }
  })
})

describe('createRenderer failed display retry', () => {
  it('does not cache the placeholder and retries the real load on the next render', async () => {
    audioManagerInstances.length = 0
    mediaInputHandles.length = 0
    mediaMockState.openError = true
    const { restore } = stubVideoRenderGlobals()
    const protocol = ref<IVideoProtocol>({
      id: 'renderer-video-retry',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        {
          trackId: 'frames-track',
          trackType: 'frames',
          isMain: true,
          children: [
            createVideoSegment('video-1', 0, 1000),
          ],
        },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as unknown as Parameters<typeof createRenderer>[0]['app'],
      manualRender: true,
      warmUpResources: false,
      videoSourceMode: 'auto',
    })

    try {
      // First render: media open fails, <video> element is unavailable in the
      // stubbed DOM, so the frame falls back to a placeholder.
      await renderer.renderAt(100)
      expect(mediaInputHandles).toHaveLength(0)

      // The failure heals: the next render must retry instead of reusing a
      // cached placeholder.
      mediaMockState.openError = false
      await renderer.renderAt(150)
      expect(mediaInputHandles.length).toBeGreaterThan(0)
      expect(mediaInputHandles[0]?.drawFrame).toHaveBeenCalled()
    }
    finally {
      mediaMockState.openError = false
      restore()
      renderer.destroy()
    }
  })
})
