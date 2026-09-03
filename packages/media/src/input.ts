import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  CanvasSink,
  Input,
  UrlSource,
  VideoSampleSink,
} from 'mediabunny'

export interface MediaMeta {
  /** Total duration in milliseconds. */
  durationMs: number
  /** Display width in pixels (rotation-aware). Zero when the file has no video track. */
  width: number
  /** Display height in pixels (rotation-aware). Zero when the file has no video track. */
  height: number
  /** Audio sample rate in Hz. Zero when the file has no audio track. */
  audioSampleRate: number
  /** Audio channel count. Zero when the file has no audio track. */
  audioChanCount: number
  hasVideo: boolean
  hasAudio: boolean
}

export interface MediaThumbnail {
  /** Timestamp in milliseconds. */
  tsMs: number
  img: Blob
}

export interface MediaThumbnailOptions {
  startMs?: number
  endMs?: number
  stepMs?: number
}

/**
 * A handle over one opened media file. All timestamps on this interface are in
 * milliseconds; conversion to the underlying seconds-based API happens inside.
 */
export interface MediaInputHandle {
  meta: () => Promise<MediaMeta>
  canDecodeVideo: () => Promise<boolean>
  canDecodeAudio: () => Promise<boolean>
  /**
   * Decode the frame at `timeMs` and draw it covering the full canvas of `ctx`.
   * Returns false when no frame exists at that timestamp.
   */
  drawFrame: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, timeMs: number) => Promise<boolean>
  /** Prepare an ordered frame sequence so export can reuse one decoder pipeline. */
  prepareVideoFrameSequence: (timestampsMs: readonly number[]) => void
  /** Decode thumbnails of the video track resized to `width` pixels. */
  thumbnails: (width: number, options?: MediaThumbnailOptions) => Promise<MediaThumbnail[]>
  /**
   * Decode the audio track between `startMs` and `endMs` into a single
   * AudioBuffer. Returns undefined when the file has no decodable audio.
   */
  decodeAudioSlice: (startMs: number, endMs: number) => Promise<AudioBuffer | undefined>
  dispose: () => void
}

/** Open a media file from a Blob/File or an http(s) URL. */
export function openMediaInput(source: Blob | string): MediaInputHandle {
  const input = new Input({
    formats: ALL_FORMATS,
    source: typeof source === 'string' ? new UrlSource(source) : new BlobSource(source),
  })

  let videoSink: VideoSampleSink | undefined
  let scheduledVideoSamples: ReturnType<VideoSampleSink['samplesAtTimestamps']> | undefined
  let scheduledVideoTimestamps: readonly number[] = []
  let scheduledVideoIndex = 0

  function clearVideoFrameSequence() {
    if (scheduledVideoSamples)
      void scheduledVideoSamples.return(undefined)
    scheduledVideoSamples = undefined
    scheduledVideoTimestamps = []
    scheduledVideoIndex = 0
  }

  async function getVideoTrack() {
    return await input.getPrimaryVideoTrack()
  }

  async function getAudioTrack() {
    return await input.getPrimaryAudioTrack()
  }

  return {
    async meta() {
      const [durationSec, videoTrack, audioTrack] = await Promise.all([
        input.computeDuration(),
        getVideoTrack(),
        getAudioTrack(),
      ])
      return {
        durationMs: Math.max(0, Math.round(durationSec * 1000)),
        width: videoTrack ? await videoTrack.getDisplayWidth() : 0,
        height: videoTrack ? await videoTrack.getDisplayHeight() : 0,
        audioSampleRate: audioTrack ? await audioTrack.getSampleRate() : 0,
        audioChanCount: audioTrack ? await audioTrack.getNumberOfChannels() : 0,
        hasVideo: !!videoTrack,
        hasAudio: !!audioTrack,
      }
    },

    async canDecodeVideo() {
      const track = await getVideoTrack()
      return !!track && await track.canDecode()
    },

    async canDecodeAudio() {
      const track = await getAudioTrack()
      return !!track && await track.canDecode()
    },

    async drawFrame(ctx, timeMs) {
      if (!videoSink) {
        const track = await getVideoTrack()
        if (!track)
          return false
        videoSink = new VideoSampleSink(track)
        if (scheduledVideoTimestamps.length) {
          scheduledVideoSamples = videoSink.samplesAtTimestamps(
            scheduledVideoTimestamps.map(timestampMs => timestampMs / 1000),
          )
        }
      }
      let sample
      const scheduledTimestamp = scheduledVideoTimestamps[scheduledVideoIndex]
      if (
        scheduledVideoSamples
        && scheduledTimestamp !== undefined
        && Math.abs(scheduledTimestamp - timeMs) < 0.01
      ) {
        scheduledVideoIndex++
        const result = await scheduledVideoSamples.next()
        sample = result.done ? null : result.value
      }
      else {
        if (scheduledVideoSamples)
          clearVideoFrameSequence()
        sample = await videoSink.getSample(timeMs / 1000)
      }
      if (!sample)
        return false
      try {
        sample.draw(ctx, 0, 0, ctx.canvas.width, ctx.canvas.height)
        return true
      }
      finally {
        sample.close()
      }
    },

    prepareVideoFrameSequence(timestampsMs) {
      clearVideoFrameSequence()
      if (!timestampsMs.length)
        return
      scheduledVideoTimestamps = [...timestampsMs]
      scheduledVideoSamples = videoSink?.samplesAtTimestamps(timestampsMs.map(timestampMs => timestampMs / 1000))
    },

    async thumbnails(width, options) {
      const track = await getVideoTrack()
      if (!track || !(await track.canDecode()))
        return []

      const durationMs = Math.round(await track.computeDuration() * 1000)
      const startMs = Math.max(0, options?.startMs ?? 0)
      const endMs = Math.min(durationMs, options?.endMs ?? durationMs)
      const stepMs = Math.max(1, options?.stepMs ?? 1000)
      if (endMs <= startMs)
        return []

      const timestampsSec: number[] = []
      for (let tsMs = startMs; tsMs <= endMs; tsMs += stepMs)
        timestampsSec.push(tsMs / 1000)

      const sink = new CanvasSink(track, { width })
      const results: MediaThumbnail[] = []
      let index = 0
      for await (const wrapped of sink.canvasesAtTimestamps(timestampsSec)) {
        const tsMs = Math.round(timestampsSec[index] * 1000)
        index++
        if (!wrapped)
          continue
        const img = await canvasToBlob(wrapped.canvas)
        if (img)
          results.push({ tsMs, img })
      }
      return results
    },

    async decodeAudioSlice(startMs, endMs) {
      const track = await getAudioTrack()
      if (!track || !(await track.canDecode()))
        return undefined
      if (endMs <= startMs)
        return undefined

      const sampleRate = await track.getSampleRate()
      const numberOfChannels = await track.getNumberOfChannels()
      const startSec = startMs / 1000
      const lengthFrames = Math.ceil((endMs - startMs) / 1000 * sampleRate)
      if (lengthFrames <= 0)
        return undefined

      const target = new AudioBuffer({ length: lengthFrames, numberOfChannels, sampleRate })
      const sink = new AudioSampleSink(track)
      let received = false
      for await (const sample of sink.samples(startSec, endMs / 1000)) {
        received = true
        const chunk = sample.toAudioBuffer()
        sample.close()
        const offsetFrames = Math.round((sample.timestamp - startSec) * sampleRate)
        copyIntoBuffer(target, chunk, offsetFrames)
      }
      return received ? target : undefined
    },

    dispose() {
      clearVideoFrameSequence()
      void input.dispose()
    },
  }
}

function copyIntoBuffer(target: AudioBuffer, chunk: AudioBuffer, offsetFrames: number) {
  // A chunk can start before the slice (decoder emits whole samples); clip it.
  const sourceStart = offsetFrames < 0 ? -offsetFrames : 0
  const targetStart = Math.max(0, offsetFrames)
  const copyLength = Math.min(chunk.length - sourceStart, target.length - targetStart)
  if (copyLength <= 0)
    return

  for (let ch = 0; ch < target.numberOfChannels; ch++) {
    const sourceChannel = Math.min(ch, chunk.numberOfChannels - 1)
    const data = new Float32Array(copyLength)
    chunk.copyFromChannel(data, sourceChannel, sourceStart)
    target.copyToChannel(data, ch, targetStart)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | undefined> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas)
    return canvas.convertToBlob({ type: 'image/png' }).catch(() => undefined)

  return new Promise((resolve) => {
    try {
      (canvas as HTMLCanvasElement).toBlob(blob => resolve(blob ?? undefined), 'image/png')
    }
    catch {
      resolve(undefined)
    }
  })
}
