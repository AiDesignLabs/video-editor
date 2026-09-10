import { ALL_FORMATS, AudioSampleSource, BlobSource, BufferTarget, Conversion, EncodedAudioPacketSource, Input, Mp4OutputFormat, Output, Quality, VideoSampleSource } from 'mediabunny'

export type SdkDiagnosticMode = 'fragmented' | 'flat' | 'bounded' | 'fanout' | 'flat-software' | 'fragmented-software' | 'shared' | 'fragmented-copy-audio' | 'flat-copy-audio'

export async function inspectSdk(source: Blob, mode: SdkDiagnosticMode) {
  if (mode.endsWith('software')) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
    registerAacEncoder()
  }
  const NativeDecoder = globalThis.VideoDecoder
  let decoders = 0
  let decodedPackets = 0
  globalThis.VideoDecoder = class extends NativeDecoder {
    constructor(init: VideoDecoderInit) {
      super(init)
      decoders++
    }

    override decode(chunk: EncodedVideoChunk) {
      decodedPackets++
      super.decode(chunk)
    }
  }
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) })
  try {
    const audio = await input.getPrimaryAudioTrack()
    const video = await input.getPrimaryVideoTrack()
    const timing = {
      firstVideo: await video?.getFirstTimestamp(),
      firstAudio: await audio?.getFirstTimestamp(),
      duration: await input.computeDuration(),
      metadataDuration: await input.getDurationFromMetadata(),
    }
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: mode.startsWith('flat') ? 'in-memory' : 'fragmented' }), target })
    const secondaryTarget = new BufferTarget()
    const secondaryOutput = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: secondaryTarget })
    const secondaryVideo = new VideoSampleSource({ codec: 'avc', quality: new Quality({ bitrate: 100_000 }), keyFrameInterval: 1, transform: { width: 32, height: 24, fit: 'fill' } })
    const secondaryAudio = new AudioSampleSource({ codec: 'aac', quality: new Quality({ bitrate: 192_000 }) })
    if (mode === 'shared') {
      secondaryOutput.addVideoTrack(secondaryVideo)
      if (audio)
        secondaryOutput.addAudioTrack(secondaryAudio)
      await secondaryOutput.start()
    }
    const videoOptions = { codec: 'avc' as const, height: 48, forceTranscode: true, quality: new Quality({ bitrate: 300_000 }), keyFrameInterval: 1 }
    const conversion = await Conversion.init({ input, output, tracks: 'primary', showWarnings: false, video: mode === 'fanout'
      ? [videoOptions, { ...videoOptions, height: 24 }]
      : { ...videoOptions, process: mode === 'shared'
          ? async (sample) => {
            await secondaryVideo.add(sample)
            return sample
          }
          : undefined }, audio: { codec: 'aac', quality: mode.endsWith('copy-audio') ? undefined : new Quality({ bitrate: 192_000 }), process: mode === 'shared'
      ? async (sample) => {
        await secondaryAudio.add(sample)
        return sample
      }
      : undefined }, ...(mode === 'bounded' ? { trim: { start: 0, end: 3 } } : {}) })
    if (!conversion.isValid || conversion.discardedTracks.length)
      throw new Error('Diagnostic conversion discarded a required track.')
    await conversion.execute()
    if (mode === 'shared') {
      secondaryVideo.close()
      if (audio)
        secondaryAudio.close()
      await secondaryOutput.finalize()
    }
    return { file: new Blob([target.buffer!], { type: 'video/mp4' }), otherFiles: mode === 'shared' ? [new Blob([secondaryTarget.buffer!], { type: 'video/mp4' })] : [], decoders, decodedPackets, timing, audioCopied: output.tracks.some(track => track.source instanceof EncodedAudioPacketSource) }
  }
  finally {
    input.dispose()
    globalThis.VideoDecoder = NativeDecoder
  }
}
