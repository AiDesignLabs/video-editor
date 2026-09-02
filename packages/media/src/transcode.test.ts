import type { Rendition, TranscodeProgress } from './transcode'
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
    audioSampleCount: 0,
    encodedAudioBuffers: 0,
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
      return { source: { passthrough: true, width: 1920, height: 1080 }, close() {} }
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
            displayWidth: 1920,
            displayHeight: 1080,
            rotation: state.trackRotation,
            codec: 'avc',
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
          toVideoFrame: () => ({ source: { passthrough: true, width: 1920, height: 1080 }, close() {} }),
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
          toAudioBuffer: () => ({ index: i }),
          close() {},
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
        state.encodedAudioBuffers += 1
      }
    },
    Output,
    StreamTarget,
    VideoSampleSink,
    AudioSampleSink,
    QUALITY_HIGH: 'high',
    QUALITY_MEDIUM: 'medium',
  }
})

const { avcHighCodecString, measureDecodeThroughput, measureEncoderThroughput, probeCodecSupport, probeVideoStats, transcode } = await import('./transcode')

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

/** Collects everything written, so a rendition's bytes can be asserted on. */
function createSink() {
  const chunks: Uint8Array[] = []
  return {
    chunks,
    stream: new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk) } }),
  }
}

function renditions(...specs: Rendition[]) {
  return specs
}

beforeEach(() => {
  state.encoders = []
  state.disposed = 0
  state.canDecode = true
  state.hasVideoTrack = true
  state.hasAudioTrack = false
  state.audioCanDecode = true
  state.audioSampleCount = 0
  state.encodedAudioBuffers = 0
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

describe('transcode', () => {
  it('streams the source audio track into every rendition', async () => {
    state.hasAudioTrack = true
    state.audioSampleCount = 3

    await transcode({
      source: new Blob(),
      renditions: renditions(
        { id: 'proxy', height: 360 },
        { id: 'preview', height: 720 },
      ),
      openSink: () => createSink().stream,
    })

    expect(state.encodedAudioBuffers).toBe(6)
  })

  it('fails instead of silently dropping an undecodable audio track', async () => {
    state.hasAudioTrack = true
    state.audioCanDecode = false

    await expect(transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
    })).rejects.toThrow('cannot decode the source audio track')
  })

  it('decodes once and feeds every rendition from the same frames', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions(
        { id: 'proxy', height: 360 },
        { id: 'preview', height: 720 },
      ),
      openSink: () => createSink().stream,
    })

    // Two encoders, five source frames each, but only five frames decoded.
    expect(state.encoders).toHaveLength(2)
    expect(state.encoders[0]!.frames).toHaveLength(5)
    expect(state.encoders[1]!.frames).toHaveLength(5)
    expect(result.framesDecoded).toBe(5)
    // Each decoded frame is released exactly once, after every rendition used it.
    expect(state.closedSamples).toBe(5)
  })

  it('derives the width from the source aspect ratio', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
    })

    // 1920x1080 at 360 high is 640 wide.
    expect(result.renditions[0]).toMatchObject({ id: 'proxy', width: 640, height: 360 })
    expect(state.encoders[0]!.canvas).toMatchObject({ width: 640, height: 360 })
  })

  it('rounds both dimensions to the nearest even number, as H.264 requires', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 361 }),
      openSink: () => createSink().stream,
    })

    // 361 -> 362, and 1920 * 362/1080 = 643.5 -> 644.
    expect(result.renditions[0]).toMatchObject({ width: 644, height: 362 })
  })

  it('passes the key frame interval through in seconds', async () => {
    await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360, keyFrameIntervalMs: 1500, videoBitrate: 600_000 }),
      openSink: () => createSink().stream,
    })

    expect(state.encoders[0]!.options).toMatchObject({ keyFrameInterval: 1.5, bitrate: 600_000 })
  })

  it('passes encoder latency and acceleration hints through per rendition', async () => {
    await transcode({
      source: new Blob(),
      renditions: renditions(
        { id: 'proxy', height: 360, latencyMode: 'realtime', hardwareAcceleration: 'prefer-hardware' },
        { id: 'preview', height: 720 },
      ),
      openSink: () => createSink().stream,
    })

    expect(state.encoders[0]!.options).toMatchObject({ latencyMode: 'realtime', hardwareAcceleration: 'prefer-hardware' })
    expect(state.encoders[1]!.options).not.toHaveProperty('latencyMode')
    expect(state.encoders[1]!.options).not.toHaveProperty('hardwareAcceleration')
  })

  it('passes decoder hints to the shared sample sink', async () => {
    await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
      decoder: { hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true },
    })

    expect(state.decoderOptions).toEqual({ hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true })
  })

  it('leaves the key frame interval to the encoder when unset', async () => {
    await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
    })

    expect(state.encoders[0]!.options).not.toHaveProperty('keyFrameInterval')
  })

  it('accounts the loop time into per-stage buckets that sum to the total', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }, { id: 'preview', height: 720 }),
      openSink: () => createSink().stream,
    })

    const { stages } = result
    expect(Object.keys(stages.encodeWaitMs)).toEqual(['proxy', 'preview'])
    expect(Object.keys(stages.captureMs)).toEqual(['proxy', 'preview'])
    // Write time is measured on the muxer's path, not in the serial loop, so it
    // is reported but deliberately not part of the tiling.
    expect(Object.keys(stages.writeMs)).toEqual(['proxy', 'preview'])
    expect(Object.keys(stages.submitSyncMs)).toEqual(['proxy', 'preview'])
    const accounted = stages.decodeWaitMs + stages.drawMs + stages.otherMs
      + stages.captureMs.proxy! + stages.captureMs.preview!
      + stages.submitSyncMs.proxy! + stages.submitSyncMs.preview!
      + stages.encodeWaitMs.proxy! + stages.encodeWaitMs.preview!
    // otherMs is defined as the remainder, so the buckets tile the total.
    expect(accounted).toBeCloseTo(stages.totalMs, 3)
    for (const value of [stages.decodeWaitMs, stages.drawMs, stages.otherMs, ...Object.values(stages.captureMs), ...Object.values(stages.encodeWaitMs)])
      expect(value).toBeGreaterThanOrEqual(0)
  })

  it('reports progress against the source frame count', async () => {
    const seen: TranscodeProgress[] = []
    await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
      onProgress: progress => seen.push({ ...progress }),
    })

    expect(seen).toHaveLength(5)
    expect(seen.map(p => p.ratio)).toEqual([0.2, 0.4, 0.6, 0.8, 1])
    expect(seen.at(-1)).toMatchObject({ framesDone: 5, framesTotal: 5, ratio: 1 })
    expect(seen.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('opens one sink per rendition', async () => {
    const opened: string[] = []
    await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }, { id: 'preview', height: 720 }),
      openSink: (rendition) => {
        opened.push(rendition.id)
        return createSink().stream
      },
    })

    expect(opened).toEqual(['proxy', 'preview'])
  })

  it('disposes the input even when the source is unusable', async () => {
    state.hasVideoTrack = false
    await expect(transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
    })).rejects.toThrow('no video track')
    expect(state.disposed).toBe(1)
  })

  it('refuses a source this browser cannot decode', async () => {
    state.canDecode = false
    await expect(transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
    })).rejects.toThrow('cannot decode')
  })

  it('requires at least one rendition', async () => {
    await expect(transcode({
      source: new Blob(),
      renditions: [],
      openSink: () => createSink().stream,
    })).rejects.toThrow('at least one rendition')
  })

  it('aborts mid-pass and cancels every encoder', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }, { id: 'preview', height: 720 }),
      openSink: () => createSink().stream,
      signal: controller.signal,
    })).rejects.toThrow(/abort/i)

    expect(state.cancelled).toBe(2)
    expect(state.finalized).toBe(0)
    // The frame in flight is still released.
    expect(state.closedSamples).toBe(1)
    expect(state.disposed).toBe(1)
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

describe('passthroughSameSize', () => {
  it('bypasses the canvas only for a rendition that matches the source size', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'same', height: 1080 }, { id: 'small', height: 360 }),
      openSink: () => createSink().stream,
      passthroughSameSize: true,
    })

    expect(result.renditions.map(r => [r.id, r.passthrough])).toEqual([['same', true], ['small', false]])
    // The same-size encoder saw decoded frames, never a canvas capture.
    expect(state.encoders[0]!.canvas).toMatchObject({ passthrough: true })
    expect(state.encoders[1]!.canvas).toMatchObject({ width: 640, height: 360 })
    expect(result.stages.captureMs.same).toBe(0)
    // Every source frame was still released exactly once.
    expect(state.closedSamples).toBe(5)
  })

  it('stays on the canvas path when opted out', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'same', height: 1080 }),
      openSink: () => createSink().stream,
      passthroughSameSize: false,
    })
    expect(result.renditions[0]!.passthrough).toBe(false)
    expect(state.encoders[0]!.canvas).toMatchObject({ width: 1920, height: 1080 })
  })
})

describe('pipelineDepth', () => {
  it('still submits every frame in order and releases every sample when calls overlap', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }, { id: 'same', height: 1080 }),
      openSink: () => createSink().stream,
      passthroughSameSize: true,
      pipelineDepth: 3,
    })

    expect(result.framesDecoded).toBe(5)
    expect(state.encoders[0]!.frames.map(f => f.ts)).toEqual([0, 0.04, 0.08, 0.12, 0.16])
    expect(state.encoders[1]!.frames).toHaveLength(5)
    expect(state.closedSamples).toBe(5)
    // Blocked time is bookkept per rendition even when nothing actually blocked.
    expect(Object.keys(result.stages.encodeWaitMs)).toEqual(['proxy', 'same'])
  })

  it('treats depth 1 as the fully awaited baseline', async () => {
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
      pipelineDepth: 1,
    })
    expect(result.framesDecoded).toBe(5)
    expect(state.encoders[0]!.frames).toHaveLength(5)
  })
})

describe('frame rate hint', () => {
  it('passes the source frame rate as track metadata so the encoder budgets bits for the real rate', async () => {
    await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'proxy', height: 360 }),
      openSink: () => createSink().stream,
    })
    // Fake source: 5 frames over a 10 s duration.
    expect(state.trackMetadata).toEqual([{ frameRate: 0.5 }])
  })
})

describe('isEightBit gate', () => {
  it('lets NV12 pass through and only diverts real 10/12-bit formats', async () => {
    state.sampleFormat = 'NV12'
    const nv12 = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'same', height: 1080 }),
      openSink: () => createSink().stream,
      passthroughSameSize: true,
    })
    expect(nv12.stages.captureMs.same).toBe(0)
    expect(state.draws).toBe(0)
    expect(nv12.stages.drawMs).toBe(0)
  })
})

describe('passthrough safety', () => {
  it('refuses to pass rotated sources through, falling back to the canvas', async () => {
    state.trackRotation = 90
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'same', height: 1080 }),
      openSink: () => createSink().stream,
      passthroughSameSize: true,
    })
    expect(result.renditions[0]!.passthrough).toBe(false)
    expect(state.encoders[0]!.frames).toHaveLength(5)
  })
})

describe('10-bit frames on a passthrough rendition', () => {
  it('take the canvas path frame by frame, since the H.264 encoder is 8-bit', async () => {
    // WebCodecs spells high bit depth as a P10/P12 suffix (`I420P10`, …); there is no `P010`.
    state.sampleFormat = 'I420P10'
    const result = await transcode({
      source: new Blob(),
      renditions: renditions({ id: 'same', height: 1080 }),
      openSink: () => createSink().stream,
      passthroughSameSize: true,
    })
    // The rendition is eligible by size, but every frame was drawn.
    expect(result.renditions[0]!.passthrough).toBe(true)
    expect(state.draws).toBe(5)
    expect(state.encoders[0]!.frames).toHaveLength(5)
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
