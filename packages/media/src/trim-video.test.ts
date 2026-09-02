import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    durationSec: 10,
    disposed: 0,
    cancelled: 0,
    discardedAudio: false,
    initOptions: undefined as Record<string, unknown> | undefined,
  },
}))

vi.mock('mediabunny', () => {
  class EncodedVideoPacketSource {}
  class EncodedAudioPacketSource {}
  const videoTrack = { type: 'video' }
  const audioTrack = { type: 'audio' }

  class StreamTarget {
    constructor(public writable: WritableStream<{ data: Uint8Array, position: number }>) {}
  }

  class Output {
    tracks: Array<{ type: string, source: unknown, isVideoTrack: () => boolean, isAudioTrack: () => boolean }> = []
    constructor(public options: { format: { mimeType: string, fileExtension: string }, target: StreamTarget }) {}
    get format() {
      return this.options.format
    }
  }

  class Input {
    async computeDuration() { return state.durationSec }
    async getPrimaryVideoTrack() { return videoTrack }
    async getPrimaryAudioTrack() { return audioTrack }
    async dispose() { state.disposed += 1 }
  }

  class ConversionCanceledError extends Error {}
  class Conversion {
    isValid = true
    discardedTracks = state.discardedAudio ? [{ track: audioTrack, reason: 'unsupported_codec' }] : []
    onProgress?: (progress: number, processedTime: number) => void
    constructor(public options: { output: Output }) {}
    static async init(options: Record<string, unknown>) {
      state.initOptions = options
      return new Conversion(options as { output: Output })
    }

    async execute() {
      this.onProgress?.(0.5, 1)
      const writer = this.options.output.options.target.writable.getWriter()
      await writer.write({ data: new Uint8Array([1, 2]), position: 0 })
      await writer.write({ data: new Uint8Array([3]), position: 2 })
      await writer.close()
      this.options.output.tracks.push(
        {
          type: 'video',
          source: {},
          isVideoTrack: () => true,
          isAudioTrack: () => false,
        },
        {
          type: 'audio',
          source: new EncodedAudioPacketSource(),
          isVideoTrack: () => false,
          isAudioTrack: () => true,
        },
      )
    }

    async cancel() {
      state.cancelled += 1
    }
  }

  class Mp4OutputFormat {
    mimeType = 'video/mp4'
    fileExtension = '.mp4'
  }
  class WebMOutputFormat {
    mimeType = 'video/webm'
    fileExtension = '.webm'
  }

  return {
    ALL_FORMATS: [],
    BlobSource: class { constructor(public source: Blob) {} },
    Conversion,
    ConversionCanceledError,
    EncodedAudioPacketSource,
    EncodedVideoPacketSource,
    Input,
    Mp4OutputFormat,
    Output,
    StreamTarget,
    UrlSource: class { constructor(public source: string) {} },
    WebMOutputFormat,
  }
})

const { trimVideo } = await import('./trim-video')

function createSink() {
  const chunks: Uint8Array[] = []
  let aborted = false
  return {
    chunks,
    get aborted() { return aborted },
    stream: new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
      abort: () => { aborted = true },
    }),
  }
}

beforeEach(() => {
  state.durationSec = 10
  state.disposed = 0
  state.cancelled = 0
  state.discardedAudio = false
  state.initOptions = undefined
})

describe('trimVideo', () => {
  it('trims primary video and audio into an append-only sink', async () => {
    const sink = createSink()
    const progress = vi.fn()
    const result = await trimVideo({
      source: new Blob(),
      startMs: 1000,
      endMs: 4000,
      sink: sink.stream,
      onProgress: progress,
    })

    expect(state.initOptions).toMatchObject({
      tracks: 'primary',
      trim: { start: 1, end: 4 },
      showWarnings: false,
    })
    expect(sink.chunks).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])])
    expect(progress).toHaveBeenCalledWith({ progress: 0.5, processedMs: 1000, totalMs: 3000 })
    expect(result).toMatchObject({
      sourceStartMs: 1000,
      sourceEndMs: 4000,
      durationMs: 3000,
      videoMode: 'transcode',
      audioMode: 'copy',
      mimeType: 'video/mp4',
    })
    expect(state.disposed).toBe(1)
  })

  it('rejects a range outside the source and aborts the sink', async () => {
    const sink = createSink()
    await expect(trimVideo({
      source: new Blob(),
      startMs: 9000,
      endMs: 11000,
      sink: sink.stream,
    })).rejects.toThrow(/exceeds source duration/)
    expect(sink.aborted).toBe(true)
    expect(state.disposed).toBe(1)
  })

  it('fails when a primary audio track would be discarded', async () => {
    state.discardedAudio = true
    const sink = createSink()
    await expect(trimVideo({
      source: new Blob(),
      startMs: 0,
      endMs: 1000,
      sink: sink.stream,
    })).rejects.toThrow(/required audio track was discarded/)
    expect(state.cancelled).toBe(1)
    expect(sink.aborted).toBe(true)
  })

  it('rejects invalid ranges before locking the sink', async () => {
    const sink = createSink()
    await expect(trimVideo({
      source: new Blob(),
      startMs: 1000,
      endMs: 1000,
      sink: sink.stream,
    })).rejects.toThrow(/endMs/)
    expect(sink.stream.locked).toBe(false)
  })

  it('rejects an already cancelled task before locking the sink', async () => {
    const controller = new AbortController()
    controller.abort()
    const sink = createSink()

    await expect(trimVideo({
      source: new Blob(),
      startMs: 0,
      endMs: 1000,
      sink: sink.stream,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(sink.stream.locked).toBe(false)
  })
})
