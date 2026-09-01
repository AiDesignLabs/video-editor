import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureCanvasStream } from './capture-canvas-stream'

function fakeTrack(requestFrame?: () => void) {
  return {
    readyState: 'live',
    requestFrame,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('captureCanvasStream', () => {
  it('uses native captureStream for an HTML canvas', async () => {
    const requested = vi.fn()
    const track = fakeTrack(requested)
    const stream = { getVideoTracks: () => [track] } as MediaStream
    const captureStream = vi.fn(() => stream)
    const canvas = { width: 16, height: 16, captureStream } as unknown as HTMLCanvasElement

    const handle = captureCanvasStream({ canvas, frameRate: 30, manual: true })
    await handle.requestFrame()
    await handle.stop()
    await handle.stop()

    expect(captureStream).toHaveBeenCalledWith(0)
    expect(requested).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('writes OffscreenCanvas frames through VideoTrackGenerator', async () => {
    class FakeOffscreenCanvas {
      width = 16
      height = 16
    }
    const frames: Array<{ source: unknown, closed: boolean }> = []
    class FakeVideoFrame {
      record: { source: unknown, closed: boolean }
      constructor(source: unknown) {
        this.record = { source, closed: false }
        frames.push(this.record)
      }

      close() {
        this.record.closed = true
      }
    }
    const track = fakeTrack()
    class FakeVideoTrackGenerator {
      track = track
      writable = new WritableStream<VideoFrame>({ write() {} })
    }
    class FakeMediaStream {
      constructor(public tracks: MediaStreamTrack[]) {}
      getVideoTracks() {
        return this.tracks
      }
    }

    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    vi.stubGlobal('VideoFrame', FakeVideoFrame)
    vi.stubGlobal('VideoTrackGenerator', FakeVideoTrackGenerator)
    vi.stubGlobal('MediaStream', FakeMediaStream)

    const canvas = new FakeOffscreenCanvas() as OffscreenCanvas
    const handle = captureCanvasStream({ canvas, frameRate: 24, manual: true })
    await handle.requestFrame()
    await handle.stop()

    expect(handle.stream.getVideoTracks()).toEqual([track])
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual({ source: canvas, closed: true })
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('fails early when OffscreenCanvas has no track generator', () => {
    class FakeOffscreenCanvas {
      width = 16
      height = 16
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    vi.stubGlobal('VideoFrame', class {})
    vi.stubGlobal('MediaStream', class {})
    vi.stubGlobal('VideoTrackGenerator', undefined)
    vi.stubGlobal('MediaStreamTrackGenerator', undefined)

    expect(() => captureCanvasStream({
      canvas: new FakeOffscreenCanvas() as OffscreenCanvas,
      frameRate: 30,
      manual: true,
    })).toThrow(/requires VideoTrackGenerator or MediaStreamTrackGenerator/)
  })

  it('rejects invalid frame rates before accessing browser APIs', () => {
    expect(() => captureCanvasStream({
      canvas: { width: 16, height: 16 } as OffscreenCanvas,
      frameRate: 0,
    })).toThrow(/frameRate/)
  })
})
