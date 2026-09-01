import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    outputs: [] as Array<{ format: { kind: string }, videoOptions?: Record<string, unknown>, audioOptions?: Record<string, unknown>, trackMetadata?: Record<string, unknown> }>,
    canEncodeVideo: true,
    canEncodeAudio: true,
    encodeVideoCalls: [] as Array<[string, Record<string, unknown>]>,
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

    addVideoTrack(source: CanvasSource | VideoSampleSource, metadata?: Record<string, unknown>) {
      this.videoSource = source
      state.outputs.push({ format: this.format, videoOptions: source.options, trackMetadata: metadata })
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
    canEncodeAudio: async () => state.canEncodeAudio,
    canEncodeVideo: async (codec: string, options: Record<string, unknown>) => {
      state.encodeVideoCalls.push([codec, options])
      return state.canEncodeVideo
    },
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

const { checkEncoderSupport, createEncoder, createMp4Encoder } = await import('./encoder')

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

describe('frameRate hint', () => {
  it('reaches the video track metadata, where mediabunny reads the encoder framerate from', () => {
    createEncoder({ canvas: fakeCanvas(), frameRate: 25 })
    expect(state.outputs.at(-1)?.trackMetadata).toEqual({ frameRate: 25 })
  })

  it('passes no metadata when unset', () => {
    createEncoder({ canvas: fakeCanvas() })
    expect(state.outputs.at(-1)?.trackMetadata).toBeUndefined()
  })
})

describe('checkEncoderSupport', () => {
  beforeEach(() => {
    state.canEncodeVideo = true
    state.canEncodeAudio = true
    state.encodeVideoCalls.length = 0
    vi.stubGlobal('VideoEncoder', class {})
  })

  it('returns null when the requested output is supported', async () => {
    await expect(checkEncoderSupport({ width: 1280, height: 720, withAudio: true })).resolves.toBeNull()
    expect(state.encodeVideoCalls[0]).toEqual(['avc', { width: 1280, height: 720 }])
  })

  it('reports a missing WebCodecs encoder', async () => {
    vi.stubGlobal('VideoEncoder', undefined)

    await expect(checkEncoderSupport({ width: 1280, height: 720 })).resolves.toMatch(/VideoEncoder is not available/)
  })

  it('reports an unsupported video codec for the resolution', async () => {
    state.canEncodeVideo = false

    await expect(checkEncoderSupport({ format: 'webm', width: 7680, height: 4320 })).resolves.toMatch(/cannot encode vp9 video at 7680x4320/)
  })

  it('reports an unsupported audio codec only when audio was requested', async () => {
    state.canEncodeAudio = false

    await expect(checkEncoderSupport({ width: 1280, height: 720 })).resolves.toBeNull()
    await expect(checkEncoderSupport({ width: 1280, height: 720, withAudio: true })).resolves.toMatch(/cannot encode aac audio/)
  })

  it('reports a codec the container cannot carry', async () => {
    await expect(checkEncoderSupport({ format: 'webm', videoCodec: 'hevc', width: 1280, height: 720 })).resolves.toBeTruthy()
  })
})

describe('encoder abort', () => {
  it('errors the stream instead of closing it', async () => {
    const handle = createEncoder({ canvas: fakeCanvas() })
    const reader = handle.stream.getReader()

    await handle.abort(new Error('encode failed'))

    await expect(reader.read()).rejects.toThrow('encode failed')
  })

  it('closes the stream on cancel', async () => {
    const handle = createEncoder({ canvas: fakeCanvas() })
    const reader = handle.stream.getReader()

    await handle.cancel()

    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })
})
