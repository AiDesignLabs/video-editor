import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, UrlSource } from 'mediabunny'

export interface SeparatedVideoAudio {
  video: Blob
  audio: Blob
}

/** Extract the primary video and audio tracks into separate MP4 files. */
export async function separateVideoAudio(source: Blob | string): Promise<SeparatedVideoAudio> {
  const input = new Input({ formats: ALL_FORMATS, source: typeof source === 'string' ? new UrlSource(source) : new BlobSource(source) })
  try {
    const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    if (!videoTrack || !audioTrack)
      throw new Error('separateVideoAudio: the source must contain video and audio tracks')
    const start = Math.min(0, await videoTrack.getFirstTimestamp(), await audioTrack.getFirstTimestamp())
    async function extract(kind: 'video' | 'audio'): Promise<Blob> {
      const target = new BufferTarget()
      const output = new Output({ format: new Mp4OutputFormat(), target })
      const conversion = await Conversion.init({ input, output, tracks: 'primary', trim: { start }, video: { discard: kind !== 'video' }, audio: { discard: kind !== 'audio' }, showWarnings: false })
      if (!conversion.isValid || conversion.discardedTracks.some(({ track }) => track === (kind === 'video' ? videoTrack : audioTrack)))
        throw new Error(`separateVideoAudio: cannot extract the ${kind} track`)
      await conversion.execute()
      if (!target.buffer)
        throw new Error(`separateVideoAudio: ${kind} output is empty`)
      return new Blob([target.buffer], { type: kind === 'video' ? 'video/mp4' : 'audio/mp4' })
    }
    return { video: await extract('video'), audio: await extract('audio') }
  }
  finally {
    input.dispose()
  }
}
