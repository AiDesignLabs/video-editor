import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    /** Every `CanvasSource` built, in creation order. */
    encoders: [] as Array<{ canvas: { width: number, height: number }, options: Record<string, unknown>, frames: Array<{ ts: number, dur: number }> }>,
    disposed: 0,
    canDecode: true,
    hasVideoTrack: true,
    hasAudioTrack: false,
    audioCanDecode: true,
    audioCanEncode: true,
    audioSampleCount: 0,
    encodedAudioSamples: 0,
    closedAudioSamples: 0,
    /** Source frames the fake decoder hands out. */
    sampleCount: 5,
    closedSamples: 0,
    draws: 0,
    finalized: 0,
    cancelled: 0,
    decoderOptions: undefined as Record<string, unknown> | undefined,
    fakeEncoders: [] as Array<{ config: Record<string, unknown> | null, encoded: Array<{ keyFrame: boolean }>, state: string }>,
    fakeEncoderQueueFull: false,
    packetSources: [] as Array<{ codec: string, packets: unknown[] }>,
    trackRotation: 0 as 0 | 90 | 180 | 270,
    trackMetadata: [] as Array<Record<string, unknown> | null>,
    sampleFormat: 'NV12' as string | null,
  },
}))

vi.mock('mediabunny', () => {
  class VideoSample {
    timestamp: number
    duration: number
    constructor(public data: unknown, init?: { timestamp?: number, duration?: number }) {
      this.timestamp = init?.timestamp ?? 0
      this.duration = init?.duration ?? 0
    }

    /** A cheap second reference, like the real one; tagged so tests can tell it from a canvas capture. */
    toVideoFrame() {
      const source = { passthrough: true, width: 1920, height: 1080 }
      return {
        source,
        clone: () => ({ source, close() {} }),
        close() {},
      }
    }

    close() {}
  }

  /** Records the canvas the VideoFrame was captured from, so dimensions can be asserted. */
  class VideoSampleSource {
    frames: Array<{ ts: number, dur: number }> = []
    canvas: { width: number, height: number } = { width: 0, height: 0 }
    constructor(public options: Record<string, unknown>) {
      state.encoders.push(this)
    }

    async add(sample: VideoSample) {
      const frame = sample.data as { source: { width: number, height: number } }
      this.canvas = frame.source
      this.frames.push({ ts: sample.timestamp, dur: sample.duration })
    }
  }

  class StreamTarget {
    constructor(public writable: WritableStream) {}
  }

  /**
   * Closes the target's writable on finalize, like the real one — without it
   * the encoder's readable never ends and `pipeTo` hangs forever.
   */
  class Output {
    target: StreamTarget
    constructor(public options: { target: StreamTarget }) {
      this.target = options.target
    }

    addVideoTrack(_source: unknown, metadata?: Record<string, unknown>) {
      state.trackMetadata.push(metadata ?? null)
    }

    addAudioTrack() {}
    async start() {}
    async finalize() {
      state.finalized += 1
      await this.target.writable.close()
    }

    async cancel() {
      state.cancelled += 1
      await this.target.writable.abort().catch(() => {})
    }
  }

  class Input {
    constructor(public options: unknown) {}
    async getPrimaryVideoTrack() {
      return state.hasVideoTrack
        ? {
            getDisplayWidth: async () => 1920,
            getDisplayHeight: async () => 1080,
            getRotation: async () => state.trackRotation,
            getCodec: async () => 'avc',
            canDecode: async () => state.canDecode,
            computePacketStats: async () => ({ packetCount: state.sampleCount }),
          }
        : null
    }

    async getPrimaryAudioTrack() {
      return state.hasAudioTrack
        ? { canDecode: async () => state.audioCanDecode }
        : null
    }

    async computeDuration() {
      return 10
    }

    async dispose() {
      state.disposed += 1
    }
  }

  class VideoSampleSink {
    constructor(public track: unknown, public decoderOptions?: Record<string, unknown>) {
      state.decoderOptions = decoderOptions
    }

    async* samples() {
      for (let i = 0; i < state.sampleCount; i++) {
        yield {
          timestamp: i * 0.04,
          duration: 0.04,
          format: state.sampleFormat,
          draw: () => {
            state.draws += 1
          },
          toVideoFrame: () => {
            const source = { passthrough: true, width: 1920, height: 1080 }
            return {
              source,
              clone: () => ({ source, close() {} }),
              close() {},
            }
          },
          close: () => {
            state.closedSamples += 1
          },
        }
      }
    }
  }

  class AudioSampleSink {
    constructor(public track: unknown) {}
    async* samples() {
      for (let i = 0; i < state.audioSampleCount; i++) {
        yield {
          index: i,
          toAudioBuffer: () => {
            throw new ReferenceError('AudioBuffer is not defined')
          },
          close: () => {
            state.closedAudioSamples += 1
          },
        }
      }
    }
  }

  class EncodedPacketSink {
    constructor(public track: unknown) {}
    async getFirstPacket() {
      return { timestamp: 0, index: 0 }
    }

    async getNextKeyPacket(packet: { timestamp: number, index: number }) {
      // Three key frames two seconds apart.
      return packet.index < 2 ? { timestamp: packet.timestamp + 2, index: packet.index + 1 } : null
    }
  }

  return {
    ALL_FORMATS: [],
    EncodedPacket: { fromEncodedChunk: (chunk: unknown) => ({ chunk }) },
    EncodedVideoPacketSource: class {
      packets: unknown[] = []
      constructor(public codec: string) {
        state.packetSources.push(this)
      }

      async add(packet: unknown) {
        this.packets.push(packet)
      }
    },
    canEncodeVideo: async (_codec: string, options: { hardwareAcceleration?: string }) => options.hardwareAcceleration !== 'prefer-software',
    canDecodeVideo: async () => true,
    canEncodeAudio: async () => state.audioCanEncode,
    BlobSource: class { constructor(public blob: unknown) {} },
    UrlSource: class { constructor(public url: unknown) {} },
    VideoSample,
    VideoSampleSource,
    EncodedPacketSink,
    Input,
    Mp4OutputFormat: class {
      constructor(public options?: Record<string, unknown>) {}
      get fileExtension() { return '.mp4' }
      get mimeType() { return 'video/mp4' }
    },
    WebMOutputFormat: class {
      get fileExtension() { return '.webm' }
      get mimeType() { return 'video/webm' }
    },
    AudioBufferSource: class {
      async add() {
        throw new Error('AudioBufferSource must not be used by transcode')
      }
    },
    AudioSampleSource: class {
      async add() {
        state.encodedAudioSamples += 1
      }
    },
    Output,
    Quality: class {
      constructor(public value: string | Record<string, unknown>) {}
    },
    StreamTarget,
    VideoSampleSink,
    AudioSampleSink,
  }
})

const { avcHighCodecString, measureDecodeThroughput, measureEncoderThroughput, probeCodecSupport, probeVideoStats } = await import('./transcode')

describe('avcHighCodecString', () => {
  it('picks the smallest level that fits the picture rate', () => {
    expect(avcHighCodecString(1280, 720, 25)).toBe('avc1.64001f') // 3.1
    expect(avcHighCodecString(1280, 720, 60)).toBe('avc1.640020') // 3.2
    expect(avcHighCodecString(1920, 1080, 30)).toBe('avc1.640028') // 4.0
    expect(avcHighCodecString(1920, 1080, 60)).toBe('avc1.64002a') // 4.2
    expect(avcHighCodecString(3840, 2160, 30)).toBe('avc1.640033') // 5.1
    expect(avcHighCodecString(3840, 2160, 60)).toBe('avc1.640034') // 5.2
  })

  it('caps at 5.2 rather than inventing a level', () => {
    expect(avcHighCodecString(7680, 4320, 60)).toBe('avc1.640034')
  })
})

beforeEach(() => {
  state.encoders = []
  state.disposed = 0
  state.canDecode = true
  state.hasVideoTrack = true
  state.hasAudioTrack = false
  state.audioCanDecode = true
  state.audioCanEncode = true
  state.audioSampleCount = 0
  state.encodedAudioSamples = 0
  state.closedAudioSamples = 0
  state.sampleCount = 5
  state.closedSamples = 0
  state.draws = 0
  state.finalized = 0
  state.cancelled = 0
  state.decoderOptions = undefined
  state.fakeEncoderQueueFull = false
  state.packetSources = []
  state.trackRotation = 0
  state.trackMetadata = []
  state.sampleFormat = 'NV12'

  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({}),
    }),
  })
  // Node has no WebCodecs; the encoder captures with `new VideoFrame(canvas)`.
  vi.stubGlobal('VideoFrame', class {
    constructor(public source: unknown, public init: unknown) {}
    close() {}
  })
  // Raw WebCodecs encoder for `measureEncoderThroughput`: emits one chunk per
  // frame synchronously, and can be told to report a full queue that drains on
  // the next task so the `dequeue` wait path is exercised.
  state.fakeEncoders = []
  vi.stubGlobal('VideoEncoder', class extends EventTarget {
    static async isConfigSupported(config: Record<string, unknown>) {
      return { supported: true, config }
    }

    encodeQueueSize = 0
    state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
    config: Record<string, unknown> | null = null
    encoded: Array<{ keyFrame: boolean }> = []
    constructor(public init: { output: (chunk: unknown) => void, error: (e: unknown) => void }) {
      super()
      state.fakeEncoders.push(this)
    }

    configure(config: Record<string, unknown>) {
      this.config = config
      this.state = 'configured'
    }

    encode(_frame: unknown, opts?: { keyFrame?: boolean }) {
      this.encoded.push({ keyFrame: Boolean(opts?.keyFrame) })
      this.init.output({})
      if (state.fakeEncoderQueueFull) {
        this.encodeQueueSize = 99
        setTimeout(() => {
          this.encodeQueueSize = 0
          this.dispatchEvent(new Event('dequeue'))
        }, 0)
      }
    }

    async flush() {}
    close() {
      this.state = 'closed'
    }
  })
})

describe('probeVideoStats', () => {
  it('measures the average key frame interval', async () => {
    const stats = await probeVideoStats(new Blob())
    // Three key frames at 0s, 2s and 4s span two intervals.
    expect(stats).toMatchObject({ codec: 'avc', keyFrameCount: 3, gopSec: 2, frameCount: 5 })
  })

  it('derives fps from the duration', async () => {
    const stats = await probeVideoStats(new Blob())
    // Five frames over ten seconds.
    expect(stats?.fps).toBeCloseTo(0.5)
  })

  it('returns undefined when there is no video track', async () => {
    state.hasVideoTrack = false
    expect(await probeVideoStats(new Blob())).toBeUndefined()
  })
})

describe('measureDecodeThroughput', () => {
  it('decodes every frame and releases each one without creating an encoder', async () => {
    const result = await measureDecodeThroughput(new Blob())
    expect(result.frames).toBe(5)
    expect(state.closedSamples).toBe(5)
    expect(state.encoders).toHaveLength(0)
    expect(result.fps).toBeGreaterThan(0)
  })

  it('stops at maxFrames so it can serve as a quick pre-flight', async () => {
    const seen: number[] = []
    const result = await measureDecodeThroughput(new Blob(), {
      maxFrames: 2,
      onProgress: p => seen.push(p.framesTotal),
    })
    expect(result.frames).toBe(2)
    // Progress reports the capped total, not the file's.
    expect(seen).toEqual([2, 2])
  })

  it('forwards decoder hints and always disposes', async () => {
    await measureDecodeThroughput(new Blob(), { decoder: { hardwareAcceleration: 'prefer-software' } })
    expect(state.decoderOptions).toEqual({ hardwareAcceleration: 'prefer-software' })
    expect(state.disposed).toBe(1)
  })
})

describe('probeCodecSupport', () => {
  it('reports encode and decode support per acceleration hint', async () => {
    const probe = await probeCodecSupport({ width: 1280, height: 720 })
    expect(probe.encode).toEqual({ 'no-preference': true, 'prefer-hardware': true, 'prefer-software': false })
    expect(probe.decode).toEqual({ 'no-preference': true, 'prefer-hardware': true, 'prefer-software': true })
  })
})

describe('measureEncoderThroughput', () => {
  it('drives a raw VideoEncoder with every decoded frame and no muxer', async () => {
    const result = await measureEncoderThroughput(new Blob(), { height: 360, framerate: 25, keyFrameIntervalMs: 80 })
    expect(state.encoders).toHaveLength(0) // no mediabunny encoder involved
    expect(state.fakeEncoders).toHaveLength(1)
    expect(result.frames).toBe(5)
    expect(result.chunks).toBe(5)
    expect(result.passthrough).toBe(false)
    expect(state.fakeEncoders[0]!.config).toMatchObject({ width: 640, height: 360, framerate: 25, codec: 'avc1.64001e' })
    // 80 ms at 25 fps = every 2nd frame is forced key.
    expect(state.fakeEncoders[0]!.encoded.map(e => e.keyFrame)).toEqual([true, false, true, false, true])
    expect(state.fakeEncoders[0]!.state).toBe('closed')
    expect(state.closedSamples).toBe(5)
  })

  it('passes decoded frames straight through when the size matches the source', async () => {
    const result = await measureEncoderThroughput(new Blob(), { height: 1080 })
    expect(result.passthrough).toBe(true)
    expect(state.fakeEncoders[0]!.config).toMatchObject({ width: 1920, height: 1080 })
  })

  it('waits on dequeue when the in-flight limit is reached and records the wait', async () => {
    state.fakeEncoderQueueFull = true
    const result = await measureEncoderThroughput(new Blob(), { height: 360, maxQueue: 4 })
    expect(result.frames).toBe(5)
    expect(result.maxQueue).toBe(4)
    expect(result.encodeWaitMs).toBeGreaterThan(0)
  })

  it('forwards encoder hints into the config', async () => {
    await measureEncoderThroughput(new Blob(), { height: 360, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' })
    expect(state.fakeEncoders[0]!.config).toMatchObject({ latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' })
  })
})
