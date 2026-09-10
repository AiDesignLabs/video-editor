import { ALL_FORMATS, AppendOnlyStreamTarget, AudioSampleSource, BlobSource, Conversion, Input, Mp4OutputFormat, Output, Quality, VideoSampleSource } from 'mediabunny'
import { transcode, validateTranscodedMedia } from '../src/conversion'

export const EXPERIMENT_MODES = ['serial', 'serial-auto-audio', 'shared', 'serial-process', 'shared-clone', 'shared-queued', 'parallel', 'serial-fps', 'shared-fps', 'serial-cbr', 'shared-cbr'] as const
export type ExperimentMode = typeof EXPERIMENT_MODES[number]
export interface ExperimentResult {
  mode: ExperimentMode
  elapsedMs: number
  firstReadyMs: number
  videoDecoders: number
  videoDecodePackets: number
  audioDecoders: number
  audioDecodePackets: number
  encoderConfigs: VideoEncoderConfig[]
  inputFrames: Array<{ width: number, height: number, timestamp: number, duration: number | null, format: VideoPixelFormat | null, hash: string }>
  files: Array<{ id: string, file: File }>
  jobId: string
}

const renditions = [
  { id: 'proxy', height: 360, videoBitrate: 600_000, keyFrameIntervalMs: 1000 },
  { id: 'preview', height: 720, videoBitrate: 2_500_000, keyFrameIntervalMs: 2000 },
]

/** Test-only composition of SDK sources. The application still uses serial Conversion. */
export async function runSharedDecodeExperiment(source: File, mode: ExperimentMode): Promise<ExperimentResult> {
  const started = performance.now()
  const jobId = crypto.randomUUID()
  const root = await navigator.storage.getDirectory()
  const experimentRoot = await root.getDirectoryHandle('video-editor-experiments', { create: true })
  const directory = await experimentRoot.getDirectoryHandle(jobId, { create: true })
  const handles = new Map<string, FileSystemFileHandle>()
  const result: ExperimentResult = { mode, elapsedMs: 0, firstReadyMs: 0, videoDecoders: 0, videoDecodePackets: 0, audioDecoders: 0, audioDecodePackets: 0, encoderConfigs: [], inputFrames: [], files: [], jobId }
  const frameReads: Promise<void>[] = []
  const NativeVideoDecoder = globalThis.VideoDecoder
  const NativeAudioDecoder = globalThis.AudioDecoder
  const NativeVideoEncoder = globalThis.VideoEncoder
  globalThis.VideoDecoder = class extends NativeVideoDecoder {
    constructor(init: VideoDecoderInit) {
      super(init)
      result.videoDecoders++
    }

    override decode(chunk: EncodedVideoChunk) {
      result.videoDecodePackets++
      super.decode(chunk)
    }
  }
  globalThis.AudioDecoder = class extends NativeAudioDecoder {
    constructor(init: AudioDecoderInit) {
      super(init)
      result.audioDecoders++
    }

    override decode(chunk: EncodedAudioChunk) {
      result.audioDecodePackets++
      super.decode(chunk)
    }
  }
  globalThis.VideoEncoder = class extends NativeVideoEncoder {
    override configure(config: VideoEncoderConfig) {
      result.encoderConfigs.push({ ...config })
      super.configure(config)
    }

    override encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions) {
      if ([411_640_000, 413_120_000].includes(frame.timestamp)) {
        const snapshot = frame.clone()
        const metadata = { width: frame.displayWidth, height: frame.displayHeight, timestamp: frame.timestamp, duration: frame.duration, format: frame.format }
        frameReads.push((async () => {
          try {
            const bytes = new Uint8Array(snapshot.allocationSize({ format: 'RGBA' }))
            await snapshot.copyTo(bytes, { format: 'RGBA' })
            const digest = await crypto.subtle.digest('SHA-256', bytes)
            result.inputFrames.push({ ...metadata, hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') })
          }
          finally { snapshot.close() }
        })())
      }
      super.encode(frame, options)
    }
  }
  const open = async (id: string) => {
    const handle = await directory.getFileHandle(`${id}.mp4`, { create: true })
    handles.set(id, handle)
    return await handle.createWritable()
  }
  const validate = async (expected: { id: string, width: number, height: number, durationMs: number, hasAudio: boolean }) => {
    const file = await handles.get(expected.id)!.getFile()
    await validateTranscodedMedia(file, expected)
    if (!result.firstReadyMs)
      result.firstReadyMs = performance.now() - started
  }
  let input: Input | undefined
  let conversion: Conversion | undefined
  let primaryOutput: Output | undefined
  let secondaryOutput: Output | undefined
  try {
    if (mode === 'serial' || mode === 'serial-auto-audio') {
      await transcode({ source, renditions, audioBitrate: 192_000, audioMode: mode === 'serial-auto-audio' ? 'auto' : 'transcode', openSink: rendition => open(rendition.id), openFileSink: rendition => open(rendition.id), validateOutput: validate })
    }
    else if (mode === 'parallel') {
      await Promise.all(renditions.map(rendition => transcode({ source, renditions: [rendition], audioBitrate: 192_000, audioMode: 'transcode', openSink: value => open(value.id), validateOutput: validate })))
    }
    else if (mode === 'serial-process' || mode === 'serial-fps' || mode === 'serial-cbr') {
      for (const rendition of renditions) {
        input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
        const video = await input.getPrimaryVideoTrack()
        const audio = await input.getPrimaryAudioTrack()
        if (!video)
          throw new Error('A video track is required.')
        const durationMs = (await input.computeDuration() - Math.max(0, await input.getFirstTimestamp())) * 1000
        const height = rendition.height
        const metrics = mode !== 'serial-process' ? await video.computeFrameRateMetrics({ targetPacketCount: Infinity }) : undefined
        const frameRate = metrics?.frameRateIsConstant ? metrics.underlyingFrameRate ?? undefined : undefined
        const width = Math.floor(await video.getDisplayWidth() * height / await video.getDisplayHeight() / 2) * 2
        primaryOutput = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: new AppendOnlyStreamTarget(await open(rendition.id)) })
        conversion = await Conversion.init({ input, output: primaryOutput, tracks: 'primary', showWarnings: false, video: { codec: 'avc', width, height, fit: 'fill', allowRotationMetadata: false, forceTranscode: true, frameRate, quality: new Quality({ bitrate: rendition.videoBitrate, bitrateMode: mode === 'serial-cbr' ? 'constant' : 'variable' }), keyFrameInterval: rendition.keyFrameIntervalMs / 1000, process: mode === 'serial-process' ? async sample => sample : undefined }, audio: { codec: 'aac', quality: new Quality({ bitrate: 192_000 }) } })
        await conversion.execute({ until: 2 })
        if (conversion.state !== 'done')
          await conversion.execute()
        await validate({ id: rendition.id, width, height, durationMs, hasAudio: !!audio })
        input.dispose()
      }
    }
    else {
      input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
      const video = await input.getPrimaryVideoTrack()
      const audio = await input.getPrimaryAudioTrack()
      if (!video || await video.hasHighDynamicRange())
        throw new Error('Experiment requires an SDR source video.')
      const durationMs = (await input.computeDuration() - Math.max(0, await input.getFirstTimestamp())) * 1000
      const sourceWidth = await video.getDisplayWidth()
      const sourceHeight = await video.getDisplayHeight()
      const size = (height: number) => {
        const h = Math.max(2, Math.floor(Math.min(height, sourceHeight) / 2) * 2)
        return { width: Math.max(2, Math.floor(sourceWidth * h / sourceHeight / 2) * 2), height: h }
      }
      const masterSize = size(720)
      const proxySize = size(360)
      const metrics = await video.computeFrameRateMetrics({ targetPacketCount: Infinity })
      const frameRate = metrics?.frameRateIsConstant ? metrics.underlyingFrameRate ?? undefined : undefined
      const audioQuality = new Quality({ bitrate: 192_000 })
      secondaryOutput = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: new AppendOnlyStreamTarget(await open('proxy')) })
      const secondaryVideo = new VideoSampleSource({ codec: 'avc', quality: new Quality({ bitrate: 600_000, bitrateMode: mode === 'shared-cbr' ? 'constant' : 'variable' }), keyFrameInterval: 1, transform: { ...proxySize, fit: 'fill' } })
      const secondaryAudio = new AudioSampleSource({ codec: 'aac', quality: audioQuality })
      const pending = new Set<Promise<void>>()
      secondaryOutput.addVideoTrack(secondaryVideo, { frameRate })
      if (audio)
        secondaryOutput.addAudioTrack(secondaryAudio)
      primaryOutput = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: new AppendOnlyStreamTarget(await open('preview')) })
      conversion = await Conversion.init({ input, output: primaryOutput, tracks: 'primary', showWarnings: false, video: { codec: 'avc', ...masterSize, fit: 'fill', allowRotationMetadata: false, forceTranscode: true, frameRate, quality: new Quality({ bitrate: 2_500_000, bitrateMode: mode === 'shared-cbr' ? 'constant' : 'variable' }), keyFrameInterval: 2, async process(sample) {
        if (mode === 'shared-clone') {
          const clone = sample.clone()
          try {
            await secondaryVideo.add(clone)
          }
          finally { clone.close() }
        }
        else if (mode === 'shared-queued') {
          const clone = sample.clone()
          const added = secondaryVideo.add(clone).finally(() => clone.close())
          pending.add(added)
          void added.then(() => pending.delete(added), () => {})
          if (pending.size >= 4)
            await Promise.race(pending)
        }
        else {
          await secondaryVideo.add(sample)
        }
        return sample
      } }, audio: { codec: 'aac', quality: audioQuality, async process(sample) {
        await secondaryAudio.add(sample)
        return sample
      } } })
      if (!conversion.isValid || conversion.discardedTracks.length)
        throw new Error('SDK discarded a required track in the shared experiment.')
      await secondaryOutput.start()
      await conversion.execute({ until: 2 })
      if (conversion.state !== 'done')
        await conversion.execute()
      await Promise.all(pending)
      await validate({ id: 'preview', ...masterSize, durationMs, hasAudio: !!audio })
      secondaryVideo.close()
      if (audio)
        secondaryAudio.close()
      await secondaryOutput.finalize()
      await validate({ id: 'proxy', ...proxySize, durationMs, hasAudio: !!audio })
    }
    result.elapsedMs = performance.now() - started
    await Promise.all(frameReads)
    result.files = await Promise.all(renditions.map(async ({ id }) => ({ id, file: await handles.get(id)!.getFile() })))
    return result
  }
  catch (error) {
    await conversion?.cancel().catch(() => {})
    await primaryOutput?.cancel().catch(() => {})
    await secondaryOutput?.cancel().catch(() => {})
    await experimentRoot.removeEntry(jobId, { recursive: true }).catch(() => {})
    throw error
  }
  finally {
    input?.dispose()
    globalThis.VideoDecoder = NativeVideoDecoder
    globalThis.AudioDecoder = NativeAudioDecoder
    globalThis.VideoEncoder = NativeVideoEncoder
  }
}
