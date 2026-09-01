import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    outputs: [] as Array<{ format: { kind: string }, videoOptions?: Record<string, unknown>, audioOptions?: Record<string, unknown> }>,
  },
}))

vi.mock('mediabunny', () => {
  class Mp4OutputFormat {
    readonly kind = 'mp4'
    constructor(public options?: Record<string, unknown>) {}
    get fileExtension() {
      return '.mp4'
    }

    get mimeType() {
      return 'video/mp4'
    }
  }

  class MkvOutputFormat {
    readonly kind: string = 'mkv'
    get fileExtension() {
      return '.mkv'
    }

    get mimeType() {
      return 'video/x-matroska'
    }
  }

  class WebMOutputFormat extends MkvOutputFormat {
    readonly kind: string = 'webm'
    constructor(public options?: Record<string, unknown>) {
      super()
    }

    get fileExtension() {
      return '.webm'
    }

    get mimeType() {
      return 'video/webm'
    }
  }

  class CanvasSource {
    constructor(public canvas: unknown, public options: Record<string, unknown>) {}
    add = vi.fn(async () => {})
  }

  class VideoSampleSource {
    constructor(public options: Record<string, unknown>) {}
    add = vi.fn(async () => {})
  }

  class VideoSample {
    constructor(public data: unknown, public init?: Record<string, unknown>) {}
    close() {}
  }

  class AudioBufferSource {
    constructor(public options: Record<string, unknown>) {}
    add = vi.fn(async () => {})
  }

  class StreamTarget {
    constructor(public writable: unknown) {}
  }

  class Output {
    format: { kind: string }
    videoSource?: CanvasSource | VideoSampleSource
    audioSource?: AudioBufferSource

    constructor(options: { format: { kind: string }, target: unknown }) {
      this.format = options.format
    }

    addVideoTrack(source: CanvasSource | VideoSampleSource) {
      this.videoSource = source
      state.outputs.push({ format: this.format, videoOptions: source.options })
    }

    addAudioTrack(source: AudioBufferSource) {
      this.audioSource = source
      const entry = state.outputs.at(-1)
      if (entry)
        entry.audioOptions = source.options
    }

    async start() {}
    async finalize() {}
    async cancel() {}
  }

  return {
    AudioBufferSource,
    CanvasSource,
    VideoSample,
    VideoSampleSource,
    MkvOutputFormat,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH: 'high',
    QUALITY_MEDIUM: 'medium',
    StreamTarget,
    WebMOutputFormat,
  }
})

const { createEncoder, createMp4Encoder } = await import('./encoder')

function fakeCanvas() {
  return { width: 16, height: 16 } as unknown as HTMLCanvasElement
}

// Node has no WebCodecs; `addFrame()` captures the canvas with `new VideoFrame()`.
vi.stubGlobal('VideoFrame', class {
  constructor(public source: unknown, public init: unknown) {}
  close() {}
})

describe('createEncoder', () => {
  beforeEach(() => {
    state.outputs.length = 0
  })

  it('defaults to a fragmented mp4 container with avc video and aac audio', () => {
    const handle = createEncoder({ canvas: fakeCanvas(), withAudio: true })

    expect(handle.mimeType).toBe('video/mp4')
    expect(handle.fileExtension).toBe('.mp4')
    expect(state.outputs[0]?.format.kind).toBe('mp4')
    expect(state.outputs[0]?.videoOptions?.codec).toBe('avc')
    expect(state.outputs[0]?.audioOptions?.codec).toBe('aac')
  })

  it('selects the webm container with vp9 video and opus audio', () => {
    const handle = createEncoder({ canvas: fakeCanvas(), format: 'webm', withAudio: true })

    expect(handle.mimeType).toBe('video/webm')
    expect(handle.fileExtension).toBe('.webm')
    expect(state.outputs[0]?.format.kind).toBe('webm')
    expect(state.outputs[0]?.videoOptions?.codec).toBe('vp9')
    expect(state.outputs[0]?.audioOptions?.codec).toBe('opus')
  })

  it('honours an explicit codec supported by the container', () => {
    createEncoder({ canvas: fakeCanvas(), format: 'webm', videoCodec: 'vp8' })
    expect(state.outputs[0]?.videoOptions?.codec).toBe('vp8')
  })

  it('throws when the codec does not match the container', () => {
    expect(() => createEncoder({ canvas: fakeCanvas(), format: 'webm', videoCodec: 'avc' }))
      .toThrow(/not supported by the webm container/)
    expect(() => createEncoder({ canvas: fakeCanvas(), format: 'mp4', videoCodec: 'vp8' }))
      .toThrow(/not supported by the mp4 container/)
  })

  it('passes bitrates through instead of the quality presets', () => {
    createEncoder({ canvas: fakeCanvas(), withAudio: true, videoBitrate: 1234, audioBitrate: 567 })

    expect(state.outputs[0]?.videoOptions).toMatchObject({ bitrate: 1234 })
    expect(state.outputs[0]?.videoOptions?.quality).toBeUndefined()
    expect(state.outputs[0]?.audioOptions).toMatchObject({ bitrate: 567 })
  })

  it('rejects setAudio when the encoder has no audio track', async () => {
    const handle = createEncoder({ canvas: fakeCanvas() })
    await expect(handle.setAudio({} as AudioBuffer)).rejects.toThrow(/withAudio/)
  })
})

describe('createMp4Encoder', () => {
  beforeEach(() => {
    state.outputs.length = 0
  })

  it('still produces an mp4 encoder with the legacy signature', async () => {
    const handle = createMp4Encoder({ canvas: fakeCanvas(), withAudio: true })

    expect(state.outputs[0]?.format.kind).toBe('mp4')
    expect(state.outputs[0]?.audioOptions?.codec).toBe('aac')
    await handle.addFrame(0, 33)
    await handle.finalize()
    expect(handle.stream).toBeInstanceOf(ReadableStream)
  })
})
