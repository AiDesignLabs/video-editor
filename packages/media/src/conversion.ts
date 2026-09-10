import type { InputTrack } from 'mediabunny'
import type { MediaFileSink, MediaFileWrite, MediaWriteSink } from './types'
import { ALL_FORMATS, AppendOnlyStreamTarget, BlobSource, canEncodeAudio, Conversion, ConversionCanceledError, EncodedAudioPacketSource, Input, Mp4OutputFormat, Output, Quality, StreamTarget, UrlSource } from 'mediabunny'
import { openMediaInput } from './input'

export interface Rendition {
  id: string
  height: number
  videoBitrate?: number
  audioBitrate?: number
  keyFrameIntervalMs?: number
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
}

export interface RenditionResult {
  id: string
  width: number
  height: number
  durationMs: number
  hasAudio: boolean
  audioMode?: 'copy' | 'transcode'
  containerLayout?: 'fragmented' | 'fast-start'
}

export interface TranscodeProgress {
  ratio: number
  renditionId: string
  renditionRatio: number
  completedRenditions: number
  totalRenditions: number
  elapsedMs: number
}

export interface TranscodeOptions {
  source: Blob | string
  renditions: Rendition[]
  openSink: (rendition: Rendition) => MediaWriteSink | Promise<MediaWriteSink>
  /** Needed only for delayed AAC tracks that require a regular fast-start MP4. */
  openFileSink?: (rendition: Rendition) => MediaFileSink | Promise<MediaFileSink>
  audio?: boolean
  audioBitrate?: number
  /** Preserve compatible AAC by default; bitrate applies when audio needs transcoding. */
  audioMode?: 'auto' | 'transcode'
  signal?: AbortSignal
  onProgress?: (progress: TranscodeProgress) => void
  /** Read back the closed output before reporting this rendition as complete. */
  validateOutput?: (result: RenditionResult) => Promise<void>
}

export interface TranscodeResult {
  renditions: RenditionResult[]
}

export type MediaConversionStage = 'inspection' | 'initialization' | 'conversion' | 'validation'
export const MEDIA_CONVERSION_SDK_VERSION = '1.56.1'

export class MediaConversionError extends Error {
  readonly code = 'MEDIA_CONVERSION_FAILED'
  readonly sdkVersion = MEDIA_CONVERSION_SDK_VERSION
  constructor(message: string, public readonly stage: MediaConversionStage, public readonly renditionId?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MediaConversionError'
  }
}

let aacRegistration: Promise<void> | undefined

async function ensureAacEncoder(sampleRate: number, numberOfChannels: number, quality: Quality) {
  if (await canEncodeAudio('aac', { sampleRate, numberOfChannels, quality })
    || await canEncodeAudio('aac', { sampleRate: 48_000, numberOfChannels: 2, quality })) {
    return
  }
  // Register the SDK's encoder in this realm, including DedicatedWorkers.
  await (aacRegistration ??= import('@mediabunny/aac-encoder').then(({ registerAacEncoder }) => registerAacEncoder()))
  if (!(await canEncodeAudio('aac', { sampleRate, numberOfChannels, quality })))
    throw new Error('AAC encoding is unavailable with the requested audio parameters.')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('Media conversion was cancelled.', 'AbortError')
}

function managedTarget<T extends Uint8Array | MediaFileWrite>(open: () => WritableStream<T> | Promise<WritableStream<T>>, create: (stream: WritableStream<T>) => AppendOnlyStreamTarget | StreamTarget) {
  let writer: WritableStreamDefaultWriter<T> | undefined
  let position = 0
  let settled = false
  const abort = async (error: unknown) => {
    if (settled)
      return
    settled = true
    try {
      await writer?.abort(error)
    }
    finally { writer?.releaseLock() }
  }
  const target = create(new WritableStream<T>({
    async write(chunk) {
      if (settled)
        throw new Error('Conversion output is already closed.')
      writer ??= (await open()).getWriter()
      // OPFS sinks may transfer/detach the buffer while writing it.
      position += chunk instanceof Uint8Array ? chunk.byteLength : chunk.data.byteLength
      await writer.write(chunk)
    },
    async close() {
      if (settled)
        return
      if (!writer || position === 0)
        throw new Error('Conversion completed without output bytes.')
      await writer.close()
      settled = true
      writer.releaseLock()
    },
    abort,
  }))
  return { target, abort }
}

/** File conversion is owned by the SDK; no manual sample or timestamp processing. */
export async function transcode(options: TranscodeOptions): Promise<TranscodeResult> {
  throwIfAborted(options.signal)
  if (!options.renditions.length)
    throw new TypeError('At least one rendition is required.')
  const ids = new Set<string>()
  for (const rendition of options.renditions) {
    if (!rendition.id || ids.has(rendition.id) || !Number.isFinite(rendition.height) || rendition.height < 2)
      throw new TypeError('Renditions require unique IDs and finite heights of at least 2 pixels.')
    ids.add(rendition.id)
    for (const value of [rendition.videoBitrate, rendition.audioBitrate ?? options.audioBitrate, rendition.keyFrameIntervalMs]) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0))
        throw new TypeError('Bitrates and keyframe intervals must be finite positive numbers.')
    }
  }
  const startedAt = performance.now()
  const prepared: Array<{ input: Input, output: Output, conversion: Conversion, stream: ReturnType<typeof managedTarget>, result: RenditionResult }> = []
  let stage: MediaConversionStage = 'inspection'
  let renditionId: string | undefined
  const cancel = () => {
    void Promise.allSettled(prepared.map(item => item.conversion.cancel()))
  }
  options.signal?.addEventListener('abort', cancel, { once: true })

  try {
    // Initialize every target first. This does not open the host's output files.
    for (const rendition of options.renditions) {
      renditionId = rendition.id
      stage = 'inspection'
      throwIfAborted(options.signal)
      const input = new Input({ formats: ALL_FORMATS, source: typeof options.source === 'string' ? new UrlSource(options.source) : new BlobSource(options.source) })
      let output: Output | undefined
      let conversion: Conversion | undefined
      try {
        const video = await input.getPrimaryVideoTrack()
        const audio = options.audio === false ? null : await input.getPrimaryAudioTrack()
        if (!video)
          throw new Error('The source has no primary video track.')
        if (await video.hasHighDynamicRange())
          throw new Error('HDR video conversion is not supported. Import an SDR source.')
        const preserveAudio = audio !== null && options.audioMode !== 'transcode' && await audio.getCodec() === 'aac'
        const delayedTrack = !!audio && ['video/quicktime', 'video/mp4'].includes((await input.getFormat()).mimeType)
          && Math.abs(Math.max(0, await audio.getFirstTimestamp()) - Math.max(0, await video.getFirstTimestamp())) > 1 / await audio.getSampleRate()
        if (delayedTrack && (!preserveAudio || !options.openFileSink))
          throw new Error('This offset source requires preserved AAC audio and a seekable MP4 output. Audio re-encoding with offsets is not yet supported reliably.')
        const sourceWidth = await video.getDisplayWidth()
        const sourceHeight = await video.getDisplayHeight()
        if (!(sourceWidth > 0 && sourceHeight > 0))
          throw new Error('The source has invalid video dimensions.')
        const height = Math.max(2, Math.floor(Math.min(rendition.height, sourceHeight) / 2) * 2)
        const width = Math.max(2, Math.floor(sourceWidth * height / sourceHeight / 2) * 2)
        const quality = new Quality(rendition.audioBitrate || options.audioBitrate ? { bitrate: rendition.audioBitrate ?? options.audioBitrate! } : 'medium')
        // Let the SDK classify the entire track; never normalize an unverified VFR source.
        const frameRateMetrics = await video.computeFrameRateMetrics({ targetPacketCount: Infinity })
        const frameRate = frameRateMetrics.frameRateIsConstant ? frameRateMetrics.underlyingFrameRate ?? undefined : undefined
        stage = 'initialization'
        if (audio && !preserveAudio)
          await ensureAacEncoder(await audio.getSampleRate(), await audio.getNumberOfChannels(), quality)
        throwIfAborted(options.signal)
        const tracks: InputTrack[] = audio ? [video, audio] : [video]
        const duration = await input.computeDuration(tracks)
        const durationMs = (duration - Math.max(0, await input.getFirstTimestamp(tracks))) * 1000
        if (!Number.isFinite(durationMs) || durationMs <= 0)
          throw new Error('The source has no finite playable duration.')
        const stream = delayedTrack
          ? managedTarget<MediaFileWrite>(() => options.openFileSink!(rendition), writable => new StreamTarget(writable))
          : managedTarget<Uint8Array>(() => options.openSink(rendition), writable => new AppendOnlyStreamTarget(writable))
        output = new Output({ format: new Mp4OutputFormat({ fastStart: delayedTrack ? 'reserve' : 'fragmented' }), target: stream.target })
        conversion = await Conversion.init({
          input,
          output,
          tracks: 'primary',
          showWarnings: false,
          video: { codec: 'avc', width, height, fit: 'fill', allowRotationMetadata: false, forceTranscode: true, frameRate, quality: rendition.videoBitrate ? new Quality({ bitrate: rendition.videoBitrate }) : new Quality('medium'), keyFrameInterval: (rendition.keyFrameIntervalMs ?? 1000) / 1000, hardwareAcceleration: rendition.hardwareAcceleration },
          audio: options.audio === false ? { discard: true } : { codec: 'aac', ...(preserveAudio ? {} : { quality, forceTranscode: true }) },
        })
        const discarded = conversion.discardedTracks.find(item => item.track === video || item.track === audio)
        if (discarded)
          throw new Error(`Required ${discarded.track.type} track cannot be converted: ${discarded.reason}.`)
        if (!conversion.isValid)
          throw new Error('The source cannot be converted to H.264/AAC MP4 in this environment.')
        const outputAudio = output.tracks.find(track => track.type === 'audio')
        if (delayedTrack) {
          if (!(outputAudio?.source instanceof EncodedAudioPacketSource))
            throw new Error('The SDK could not preserve the offset audio track without re-encoding.')
          const videoPackets = (await video.computePacketStats()).packetCount
          const audioPackets = (await audio!.computePacketStats()).packetCount
          for (const track of output.tracks)
            track.metadata.maximumPacketCount = Math.ceil((track.type === 'video' ? videoPackets : audioPackets) * 4 / 3) + 1
        }
        prepared.push({ input, output, conversion, stream, result: { id: rendition.id, width, height, durationMs, hasAudio: !!audio, containerLayout: delayedTrack ? 'fast-start' : 'fragmented', ...(outputAudio ? { audioMode: outputAudio.source instanceof EncodedAudioPacketSource ? 'copy' as const : 'transcode' as const } : {}) } })
      }
      catch (error) {
        await conversion?.cancel().catch(() => {})
        await output?.cancel().catch(() => {})
        input.dispose()
        throw error
      }
    }

    for (const [index, item] of prepared.entries()) {
      renditionId = item.result.id
      stage = 'conversion'
      throwIfAborted(options.signal)
      const report = (ratio: number, complete = false) => {
        const current = complete ? 1 : Math.min(0.99, Math.max(0, ratio))
        options.onProgress?.({ ratio: (index + current) / prepared.length, renditionId: item.result.id, renditionRatio: current, completedRenditions: index + Number(complete), totalRenditions: prepared.length, elapsedMs: performance.now() - startedAt })
      }
      report(0)
      item.conversion.onProgress = ratio => report(ratio)
      await item.conversion.execute({ until: 2 })
      throwIfAborted(options.signal)
      if (item.conversion.state !== 'done')
        await item.conversion.execute()
      throwIfAborted(options.signal)
      stage = 'validation'
      await options.validateOutput?.(item.result)
      throwIfAborted(options.signal)
      report(1, true)
      item.input.dispose()
    }
    return { renditions: prepared.map(item => item.result) }
  }
  catch (error) {
    await Promise.allSettled(prepared.map(async (item) => {
      await item.conversion.cancel().catch(() => {})
      await item.stream.abort(error)
    }))
    if (options.signal?.aborted || error instanceof ConversionCanceledError || (error instanceof Error && error.name === 'AbortError'))
      throw new DOMException('Media conversion was cancelled.', 'AbortError')
    throw new MediaConversionError(error instanceof Error ? error.message : String(error), stage, renditionId, { cause: error })
  }
  finally {
    options.signal?.removeEventListener('abort', cancel)
    prepared.forEach(item => item.input.dispose())
  }
}

export async function validateTranscodedMedia(source: Blob, expected: RenditionResult) {
  const input = openMediaInput(source)
  try {
    const meta = await input.meta({ includeFrameRate: false })
    if (!source.size || !meta.hasVideo || meta.videoCodec !== 'avc' || meta.width !== expected.width || meta.height !== expected.height
      || meta.hasAudio !== expected.hasAudio || (expected.hasAudio && meta.audioCodec !== 'aac')
      || !Number.isFinite(meta.durationMs) || Math.abs(meta.durationMs - expected.durationMs) > 250) {
      throw new MediaConversionError('The converted file has invalid video, audio, dimensions or duration.', 'validation', expected.id)
    }
    return meta
  }
  finally {
    input.dispose()
  }
}
