import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaConversionError, transcode } from './conversion'

const state = vi.hoisted(() => ({
  hdr: false,
  missingVideo: false,
  discardedAudio: false,
  failAt: '',
  active: 0,
  peak: 0,
  disposed: 0,
  options: [] as Array<Record<string, unknown>>,
  cancelled: 0,
  cfr: true,
}))

vi.mock('mediabunny', () => {
  const video = { type: 'video', computeFrameRateMetrics: async () => ({ frameRateIsConstant: state.cfr, underlyingFrameRate: 25 }), hasHighDynamicRange: async () => state.hdr, getFirstTimestamp: async () => 0, getDisplayWidth: async () => 1280, getDisplayHeight: async () => 720 }
  const audio = { type: 'audio', getCodec: async () => 'aac', getFirstTimestamp: async () => 0, getSampleRate: async () => 32_000, getNumberOfChannels: async () => 2 }
  class Input {
    getPrimaryVideoTrack = async () => state.missingVideo ? null : video
    getPrimaryAudioTrack = async () => audio
    getFormat = async () => ({ mimeType: 'video/mp4' })
    computeDuration = async () => 5
    getDurationFromMetadata = async () => 5
    getFirstTimestamp = async () => 0
    dispose() { state.disposed++ }
  }
  class StreamTarget {
    constructor(public writable: WritableStream<Uint8Array>) {}
  }
  class Output {
    tracks = []
    constructor(public options: { target: StreamTarget }) {}
    cancel = async () => {}
  }
  class ConversionCanceledError extends Error {}
  class Conversion {
    state = 'idle'
    isValid = true
    discardedTracks = state.discardedAudio ? [{ track: audio, reason: 'undecodable_source_codec' }] : []
    onProgress?: (ratio: number) => void
    constructor(public output: Output) {}
    static async init(options: { output: Output }) {
      state.options.push(options)
      return new Conversion(options.output)
    }

    async execute(options?: { until: number }) {
      if (this.state === 'canceled')
        throw new ConversionCanceledError()
      if (options)
        return
      state.active++
      state.peak = Math.max(state.peak, state.active)
      try {
        if (state.failAt === 'execute')
          throw new Error('Encoder unavailable')
        const writer = this.output.options.target.writable.getWriter()
        try {
          await writer.write(new Uint8Array([1, 2, 3]))
          this.onProgress?.(1)
          await writer.close()
        }
        finally {
          writer.releaseLock()
        }
        this.state = 'done'
      }
      finally { state.active-- }
    }

    async cancel() {
      this.state = 'canceled'
      state.cancelled++
    }
  }
  return { ALL_FORMATS: [], BlobSource: class {}, UrlSource: class {}, Input, Output, StreamTarget, EncodedAudioPacketSource: class {}, AppendOnlyStreamTarget: StreamTarget, Conversion, ConversionCanceledError, Mp4OutputFormat: class {}, Quality: class { constructor(public value: unknown) {} }, canEncodeAudio: async () => true }
})

beforeEach(() => {
  Object.assign(state, { hdr: false, missingVideo: false, discardedAudio: false, failAt: '', active: 0, peak: 0, disposed: 0, cancelled: 0, options: [], cfr: true })
})

describe('sDK rendition conversion', () => {
  it.each([true, false])('uses the SDK CFR classification without forcing VFR to a guessed frame rate (%s)', async (cfr) => {
    state.cfr = cfr
    await transcode({ source: new Blob(), renditions: [{ id: 'preview', height: 360 }], openSink: () => new WritableStream() })
    expect(state.options[0]?.video).toMatchObject({ frameRate: cfr ? 25 : undefined })
  })

  it.each(['auto', 'transcode'] as const)('preserves compatible audio unless transcoding was requested (%s)', async (audioMode) => {
    await transcode({ source: new Blob(), renditions: [{ id: 'preview', height: 360 }], audioBitrate: 192_000, audioMode, openSink: () => new WritableStream() })
    const options = state.options[0]?.audio as Record<string, unknown>
    expect(options.codec).toBe('aac')
    expect(Boolean(options.quality)).toBe(audioMode === 'transcode')
    expect(options.forceTranscode).toBe(audioMode === 'transcode' ? true : undefined)
  })
  it('initializes all targets, converts serially and reports completion only after validation', async () => {
    const events: string[] = []
    const progress: number[] = []
    const result = await transcode({ source: new Blob(['source']), renditions: [{ id: '720', height: 720 }, { id: '360', height: 360 }], openSink(rendition) {
      expect(state.options).toHaveLength(2)
      events.push(`open:${rendition.id}`)
      return new WritableStream({ close() {
        events.push(`close:${rendition.id}`)
      } })
    }, async validateOutput(rendition) { events.push(`validate:${rendition.id}`) }, onProgress(value) {
      progress.push(value.ratio)
      if (value.renditionRatio === 1)
        expect(events.at(-1)).toBe(`validate:${value.renditionId}`)
    } })
    expect(events).toEqual(['open:720', 'close:720', 'validate:720', 'open:360', 'close:360', 'validate:360'])
    expect(state.peak).toBe(1)
    expect(progress.at(-1)).toBe(1)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(result.renditions).toMatchObject([{ id: '720', width: 1280, height: 720 }, { id: '360', width: 640, height: 360 }])
  })

  it.each(['hdr', 'missingVideo', 'discardedAudio'] as const)('rejects %s before opening output storage', async (problem) => {
    state[problem] = true
    const openSink = vi.fn(() => new WritableStream<Uint8Array>())
    await expect(transcode({ source: new Blob(), renditions: [{ id: 'preview', height: 360 }], openSink })).rejects.toBeInstanceOf(MediaConversionError)
    expect(openSink).not.toHaveBeenCalled()
    expect(state.disposed).toBeGreaterThan(0)
  })

  it('does not start the next rendition after validation fails', async () => {
    const openSink = vi.fn(() => new WritableStream<Uint8Array>())
    await expect(transcode({ source: new Blob(), renditions: [{ id: 'first', height: 360 }, { id: 'second', height: 720 }], openSink, validateOutput: async () => {
      throw new Error('Invalid audio track')
    } })).rejects.toMatchObject({ stage: 'validation', renditionId: 'first', message: 'Invalid audio track' })
    expect(openSink).toHaveBeenCalledTimes(1)
    expect(state.cancelled).toBe(2)
  })

  it('preserves write errors and stops every pending conversion', async () => {
    await expect(transcode({ source: new Blob(), renditions: [{ id: 'preview', height: 360 }], openSink: () => new WritableStream({ write() {
      throw new Error('Storage quota exceeded')
    } }) })).rejects.toMatchObject({ stage: 'conversion', renditionId: 'preview', message: 'Storage quota exceeded' })
    expect(state.cancelled).toBe(1)
  })

  it('cancels before execution without opening output files', async () => {
    const controller = new AbortController()
    controller.abort()
    const openSink = vi.fn(() => new WritableStream<Uint8Array>())
    await expect(transcode({ source: new Blob(), renditions: [{ id: 'preview', height: 360 }], openSink, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(openSink).not.toHaveBeenCalled()
  })
})
