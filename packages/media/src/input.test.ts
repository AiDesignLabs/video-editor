import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openMediaInput } from './input'

const { state } = vi.hoisted(() => ({
  state: {
    videoTrack: undefined as Record<string, unknown> | undefined,
    audioTrack: undefined as Record<string, unknown> | undefined,
    videoSamples: [] as Array<{ timestamp: number, draw: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn> }>,
    videoSampleRequests: [] as number[],
    videoSequenceRequests: [] as number[][],
    audioSamples: [] as Array<{ timestamp: number, buffer: MockAudioBuffer }>,
  },
}))

class MockAudioBuffer {
  readonly length: number
  readonly numberOfChannels: number
  readonly sampleRate: number
  readonly duration: number
  private channels: Float32Array[]

  constructor(options: { length: number, numberOfChannels: number, sampleRate: number }) {
    this.length = options.length
    this.numberOfChannels = options.numberOfChannels
    this.sampleRate = options.sampleRate
    this.duration = options.length / options.sampleRate
    this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length))
  }

  getChannelData(channel: number) {
    return this.channels[channel]!
  }

  copyFromChannel(destination: Float32Array, channel: number, start = 0) {
    destination.set(this.channels[channel]!.subarray(start, start + destination.length))
  }

  copyToChannel(source: Float32Array, channel: number, start = 0) {
    this.channels[channel]!.set(source, start)
  }
}

vi.stubGlobal('AudioBuffer', MockAudioBuffer)

vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  UrlSource: class {},
  Input: class {
    async getPrimaryVideoTrack() {
      return state.videoTrack ?? null
    }

    async getPrimaryAudioTrack() {
      return state.audioTrack ?? null
    }

    async computeDuration() {
      return 1.5
    }

    dispose() {}
  },
  VideoSampleSink: class {
    async getSample(timestamp: number) {
      state.videoSampleRequests.push(timestamp)
      return state.videoSamples.find(s => s.timestamp === timestamp) ?? null
    }

    async* samplesAtTimestamps(timestamps: Iterable<number>) {
      const requested = [...timestamps]
      state.videoSequenceRequests.push(requested)
      for (const timestamp of requested)
        yield state.videoSamples.find(s => s.timestamp === timestamp) ?? null
    }
  },
  CanvasSink: class {},
  AudioSampleSink: class {
    async* samples(startSec: number, endSec: number) {
      for (const sample of state.audioSamples) {
        if (sample.timestamp >= startSec && sample.timestamp < endSec) {
          yield {
            timestamp: sample.timestamp,
            toAudioBuffer: () => sample.buffer,
            close: vi.fn(),
          }
        }
      }
    }
  },
}))

describe('openMediaInput', () => {
  beforeEach(() => {
    state.videoTrack = undefined
    state.audioTrack = undefined
    state.videoSamples.length = 0
    state.videoSampleRequests.length = 0
    state.videoSequenceRequests.length = 0
    state.audioSamples.length = 0
  })

  it('converts drawFrame milliseconds to seconds and closes the sample', async () => {
    state.videoTrack = { canDecode: async () => true }
    const draw = vi.fn()
    const close = vi.fn()
    state.videoSamples.push({ timestamp: 1.5, draw, close })

    const handle = openMediaInput(new Blob())
    const ctx = { canvas: { width: 640, height: 360 } } as unknown as CanvasRenderingContext2D
    const drawn = await handle.drawFrame(ctx, 1500)

    expect(drawn).toBe(true)
    expect(draw).toHaveBeenCalledWith(ctx, 0, 0, 640, 360)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes the sample even when drawing throws', async () => {
    state.videoTrack = { canDecode: async () => true }
    const close = vi.fn()
    state.videoSamples.push({
      timestamp: 0,
      draw: vi.fn(() => {
        throw new Error('draw failed')
      }),
      close,
    })

    const handle = openMediaInput(new Blob())
    const ctx = { canvas: { width: 10, height: 10 } } as unknown as CanvasRenderingContext2D
    await expect(handle.drawFrame(ctx, 0)).rejects.toThrow('draw failed')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('decodes a prepared frame sequence through one optimized iterator', async () => {
    state.videoTrack = { canDecode: async () => true }
    const first = { timestamp: 0, draw: vi.fn(), close: vi.fn() }
    const second = { timestamp: 0.04, draw: vi.fn(), close: vi.fn() }
    state.videoSamples.push(first, second)

    const handle = openMediaInput(new Blob())
    handle.prepareVideoFrameSequence([0, 40])
    const ctx = { canvas: { width: 320, height: 180 } } as unknown as CanvasRenderingContext2D

    await expect(handle.drawFrame(ctx, 0)).resolves.toBe(true)
    await expect(handle.drawFrame(ctx, 40)).resolves.toBe(true)

    expect(state.videoSequenceRequests).toEqual([[0, 0.04]])
    expect(state.videoSampleRequests).toEqual([])
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).toHaveBeenCalledTimes(1)
  })

  it('falls back to random access when rendering leaves the prepared sequence', async () => {
    state.videoTrack = { canDecode: async () => true }
    state.videoSamples.push({ timestamp: 0.5, draw: vi.fn(), close: vi.fn() })

    const handle = openMediaInput(new Blob())
    handle.prepareVideoFrameSequence([0, 40])
    const ctx = { canvas: { width: 320, height: 180 } } as unknown as CanvasRenderingContext2D

    await expect(handle.drawFrame(ctx, 500)).resolves.toBe(true)

    expect(state.videoSampleRequests).toEqual([0.5])
  })

  it('stitches decoded audio chunks into one buffer at sample-accurate offsets', async () => {
    state.audioTrack = {
      canDecode: async () => true,
      getSampleRate: async () => 1000,
      getNumberOfChannels: async () => 1,
    }
    const chunkA = new MockAudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 1000 })
    chunkA.getChannelData(0).fill(0.5)
    const chunkB = new MockAudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 1000 })
    chunkB.getChannelData(0).fill(0.25)
    // startMs 1000 → buffer position 0 is source second 1.0
    state.audioSamples.push({ timestamp: 1, buffer: chunkA })
    state.audioSamples.push({ timestamp: 1.1, buffer: chunkB })

    const handle = openMediaInput(new Blob())
    const result = await handle.decodeAudioSlice(1000, 1200)

    expect(result).toBeDefined()
    expect(result!.length).toBe(200)
    const data = (result as unknown as MockAudioBuffer).getChannelData(0)
    expect(data[0]).toBeCloseTo(0.5, 6)
    expect(data[99]).toBeCloseTo(0.5, 6)
    expect(data[100]).toBeCloseTo(0.25, 6)
    expect(data[199]).toBeCloseTo(0.25, 6)
  })

  it('returns undefined for a slice when the track cannot be decoded', async () => {
    state.audioTrack = { canDecode: async () => false }
    const handle = openMediaInput(new Blob())
    await expect(handle.decodeAudioSlice(0, 1000)).resolves.toBeUndefined()
  })
})
