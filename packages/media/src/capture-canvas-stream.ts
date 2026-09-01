export interface CaptureCanvasStreamOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas
  frameRate: number
  /** Disable the internal timer; the caller requests each completed frame. */
  manual?: boolean
  /** Receives failures raised by automatic OffscreenCanvas capture. */
  onError?: (error: unknown) => void
}

export interface CaptureCanvasStreamHandle {
  stream: MediaStream
  videoTrack: MediaStreamTrack
  /** Capture the canvas once. In automatic mode this can also request an extra frame. */
  requestFrame: () => Promise<void>
  /** Stop capture and release the track writer. Safe to call more than once. */
  stop: () => Promise<void>
}

interface VideoTrackGeneratorHandle {
  track: MediaStreamTrack
  writable: WritableStream<VideoFrame>
}

interface MediaStreamTrackGeneratorHandle extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>
}

type CanvasStreamRuntime = typeof globalThis & {
  VideoTrackGenerator?: new () => VideoTrackGeneratorHandle
  MediaStreamTrackGenerator?: new (options: { kind: 'video' }) => MediaStreamTrackGeneratorHandle
}

function assertFrameRate(frameRate: number) {
  if (!Number.isFinite(frameRate) || frameRate <= 0)
    throw new TypeError('captureCanvasStream: frameRate must be a positive finite number')
}

function isNativeCaptureCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): canvas is HTMLCanvasElement {
  return 'captureStream' in canvas && typeof canvas.captureStream === 'function'
}

function isCanvasCaptureTrack(track: MediaStreamTrack): track is CanvasCaptureMediaStreamTrack {
  return 'requestFrame' in track && typeof track.requestFrame === 'function'
}

function createNativeCanvasStream(
  options: CaptureCanvasStreamOptions,
  canvas: HTMLCanvasElement,
): CaptureCanvasStreamHandle {
  const stream = canvas.captureStream(options.manual ? 0 : options.frameRate)
  const videoTrack = stream.getVideoTracks()[0]
  if (!videoTrack)
    throw new Error('captureCanvasStream: canvas.captureStream() returned no video track')
  if (!isCanvasCaptureTrack(videoTrack)) {
    videoTrack.stop()
    throw new Error('captureCanvasStream: the canvas video track does not support requestFrame()')
  }

  let stopped = false
  let stopPromise: Promise<void> | undefined
  return {
    stream,
    videoTrack,
    async requestFrame() {
      if (stopped || videoTrack.readyState === 'ended')
        throw new DOMException('captureCanvasStream has stopped', 'InvalidStateError')
      videoTrack.requestFrame()
    },
    stop() {
      stopped = true
      stopPromise ??= Promise.resolve().then(() => videoTrack.stop())
      return stopPromise
    },
  }
}

function createTrackGenerator() {
  const runtime = globalThis as CanvasStreamRuntime
  if (runtime.VideoTrackGenerator) {
    const generator = new runtime.VideoTrackGenerator()
    return { track: generator.track, writable: generator.writable }
  }
  if (runtime.MediaStreamTrackGenerator) {
    const generator = new runtime.MediaStreamTrackGenerator({ kind: 'video' })
    return { track: generator, writable: generator.writable }
  }
  throw new Error(
    'captureCanvasStream: OffscreenCanvas requires VideoTrackGenerator or MediaStreamTrackGenerator',
  )
}

function createOffscreenCanvasStream(
  options: CaptureCanvasStreamOptions,
  canvas: OffscreenCanvas,
): CaptureCanvasStreamHandle {
  if (typeof VideoFrame === 'undefined')
    throw new Error('captureCanvasStream: OffscreenCanvas requires VideoFrame')
  if (typeof MediaStream === 'undefined')
    throw new Error('captureCanvasStream: OffscreenCanvas requires MediaStream in this execution context')

  const { track: videoTrack, writable } = createTrackGenerator()
  const writer = writable.getWriter()
  const stream = new MediaStream([videoTrack])
  const startedAt = performance.now()
  const frameDurationUs = Math.round(1_000_000 / options.frameRate)
  let lastTimestampUs = -1
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  let pending = Promise.resolve()
  let stopPromise: Promise<void> | undefined

  const requestFrame = () => {
    if (stopped)
      return Promise.reject(new DOMException('captureCanvasStream has stopped', 'InvalidStateError'))

    const request = pending.then(async () => {
      const elapsedUs = Math.round((performance.now() - startedAt) * 1000)
      const timestamp = Math.max(elapsedUs, lastTimestampUs + 1)
      lastTimestampUs = timestamp
      const frame = new VideoFrame(canvas, { timestamp, duration: frameDurationUs })
      try {
        await writer.write(frame)
      }
      finally {
        frame.close()
      }
    })
    pending = request
    return request
  }

  const stop = () => {
    if (stopPromise)
      return stopPromise
    stopped = true
    if (timer !== undefined)
      clearInterval(timer)
    stopPromise = pending
      .catch(() => {})
      .then(async () => {
        await writer.close().catch(() => {})
        videoTrack.stop()
      })
    return stopPromise
  }

  if (!options.manual) {
    timer = setInterval(() => {
      void requestFrame().catch((error) => {
        options.onError?.(error)
        void stop()
      })
    }, 1000 / options.frameRate)
  }

  return { stream, videoTrack, requestFrame, stop }
}

/** Capture an HTML or offscreen canvas as a real-time video MediaStream. */
export function captureCanvasStream(options: CaptureCanvasStreamOptions): CaptureCanvasStreamHandle {
  assertFrameRate(options.frameRate)
  if (options.canvas.width <= 0 || options.canvas.height <= 0)
    throw new TypeError('captureCanvasStream: canvas dimensions must be greater than zero')

  if (isNativeCaptureCanvas(options.canvas))
    return createNativeCanvasStream(options, options.canvas)

  if (typeof OffscreenCanvas === 'undefined' || !(options.canvas instanceof OffscreenCanvas)) {
    throw new TypeError(
      'captureCanvasStream: canvas must be an HTMLCanvasElement or OffscreenCanvas',
    )
  }
  return createOffscreenCanvasStream(options, options.canvas)
}
