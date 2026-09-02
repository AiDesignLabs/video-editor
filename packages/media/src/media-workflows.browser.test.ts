import type { CaptureCanvasStreamHandle } from './capture-canvas-stream'
import { describe, expect, it } from 'vitest'
import { captureCanvasStream } from './capture-canvas-stream'
import { checkEncoderSupport } from './encoder'
import { openMediaInput } from './input'
import { renderCanvasToVideo } from './render-canvas-to-video'
import { trimVideo } from './trim-video'

function createCollectingSink() {
  const chunks: ArrayBuffer[] = []
  return {
    chunks,
    sink: new WritableStream<Uint8Array>({
      write(chunk) {
        const copy = new Uint8Array(chunk.byteLength)
        copy.set(chunk)
        chunks.push(copy.buffer)
      },
    }),
  }
}

function createAudio(durationMs: number) {
  const sampleRate = 48_000
  const buffer = new AudioBuffer({
    length: Math.ceil(durationMs / 1000 * sampleRate),
    numberOfChannels: 1,
    sampleRate,
  })
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index++)
    samples[index] = Math.sin(2 * Math.PI * 220 * index / sampleRate) * 0.1
  return buffer
}

async function createTestVideo(durationMs = 1000) {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Browser test requires a 2D canvas context')

  const supportError = await checkEncoderSupport({
    format: 'mp4',
    width: canvas.width,
    height: canvas.height,
    withAudio: true,
  })
  expect(supportError).toBeNull()

  const output = createCollectingSink()
  const result = await renderCanvasToVideo({
    canvas,
    durationMs,
    fps: 10,
    audio: createAudio(durationMs),
    sink: output.sink,
    renderFrame({ frameIndex }) {
      context.fillStyle = frameIndex % 2 === 0 ? '#d62f2f' : '#1a6fb3'
      context.fillRect(0, 0, canvas.width, canvas.height)
    },
  })
  return new Blob(output.chunks, { type: result.mimeType })
}

async function connectLoopback(handle: CaptureCanvasStreamHandle) {
  const sender = new RTCPeerConnection()
  const receiver = new RTCPeerConnection()
  sender.onicecandidate = event => event.candidate && void receiver.addIceCandidate(event.candidate)
  receiver.onicecandidate = event => event.candidate && void sender.addIceCandidate(event.candidate)
  const remoteTrack = new Promise<MediaStreamTrack>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('WebRTC loopback timed out')), 5000)
    receiver.ontrack = (event) => {
      window.clearTimeout(timeout)
      resolve(event.track)
    }
  })

  sender.addTrack(handle.videoTrack, handle.stream)
  const offer = await sender.createOffer()
  await sender.setLocalDescription(offer)
  await receiver.setRemoteDescription(offer)
  const answer = await receiver.createAnswer()
  await receiver.setLocalDescription(answer)
  await sender.setRemoteDescription(answer)

  return {
    track: await remoteTrack,
    close() {
      sender.close()
      receiver.close()
    },
  }
}

describe('media browser workflows', () => {
  it('renders, reads and trims a real video with audio', async () => {
    const source = await createTestVideo()
    const input = openMediaInput(source)
    const sourceMeta = await input.meta()
    input.dispose()

    expect(sourceMeta).toMatchObject({
      width: 64,
      height: 64,
      hasVideo: true,
      hasAudio: true,
    })
    expect(sourceMeta.durationMs).toBeGreaterThanOrEqual(900)

    const output = createCollectingSink()
    const result = await trimVideo({
      source,
      startMs: 200,
      endMs: 800,
      sink: output.sink,
    })
    expect(result).toMatchObject({ durationMs: 600, mimeType: 'video/mp4' })

    const trimmed = openMediaInput(new Blob(output.chunks, { type: result.mimeType }))
    const trimmedMeta = await trimmed.meta()
    trimmed.dispose()
    expect(trimmedMeta.hasVideo).toBe(true)
    expect(trimmedMeta.hasAudio).toBe(true)
    expect(trimmedMeta.durationMs).toBeGreaterThanOrEqual(500)
    expect(trimmedMeta.durationMs).toBeLessThanOrEqual(700)
  }, 20_000)

  it('sends an HTML canvas track through a WebRTC loopback', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    canvas.getContext('2d')?.fillRect(0, 0, 32, 32)
    const capture = captureCanvasStream({ canvas, frameRate: 10, manual: true })
    const loopback = await connectLoopback(capture)
    try {
      await capture.requestFrame()
      expect(loopback.track.kind).toBe('video')
      expect(loopback.track.readyState).toBe('live')
    }
    finally {
      loopback.close()
      await capture.stop()
    }
  }, 10_000)

  it('sends an OffscreenCanvas track through a WebRTC loopback', async () => {
    const canvas = new OffscreenCanvas(32, 32)
    canvas.getContext('2d')?.fillRect(0, 0, 32, 32)
    const capture = captureCanvasStream({ canvas, frameRate: 10, manual: true })
    const loopback = await connectLoopback(capture)
    try {
      await capture.requestFrame()
      expect(loopback.track.kind).toBe('video')
      expect(loopback.track.readyState).toBe('live')
    }
    finally {
      loopback.close()
      await capture.stop()
    }
  }, 10_000)
})
