import type { StreamTargetChunk } from 'mediabunny'
import type { EncoderFormat } from './encoder'
import type { MediaWriteSink } from './types'
import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  ConversionCanceledError,
  EncodedAudioPacketSource,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  WebMOutputFormat,
} from 'mediabunny'

export interface TrimVideoProgress {
  /** Normalized progress from 0 to 1. */
  progress: number
  processedMs: number
  totalMs: number
}

export interface TrimVideoOptions {
  source: Blob | string
  startMs: number
  endMs: number
  sink: MediaWriteSink
  format?: EncoderFormat
  signal?: AbortSignal
  onProgress?: (progress: TrimVideoProgress) => void
}

export interface TrimVideoResult {
  sourceStartMs: number
  sourceEndMs: number
  durationMs: number
  mimeType: string
  fileExtension: string
  videoMode: 'copy' | 'transcode'
  audioMode?: 'copy' | 'transcode'
}

function createSource(source: Blob | string) {
  return typeof source === 'string' ? new UrlSource(source) : new BlobSource(source)
}

function createOutputFormat(format: EncoderFormat) {
  return format === 'webm'
    ? new WebMOutputFormat()
    : new Mp4OutputFormat({ fastStart: 'fragmented' })
}

function abortError() {
  return new DOMException('trimVideo aborted', 'AbortError')
}

function validateRange(startMs: number, endMs: number) {
  if (!Number.isFinite(startMs) || startMs < 0)
    throw new TypeError('trimVideo: startMs must be a finite number greater than or equal to zero')
  if (!Number.isFinite(endMs) || endMs <= startMs)
    throw new TypeError('trimVideo: endMs must be a finite number greater than startMs')
}

function createAppendOnlyTarget(sink: MediaWriteSink) {
  const writer = sink.getWriter()
  let nextPosition = 0
  let settled = false

  const close = async () => {
    if (settled)
      return
    settled = true
    await writer.close()
  }
  const abort = async (reason: unknown) => {
    if (settled)
      return
    settled = true
    await writer.abort(reason)
  }
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      if (chunk.position !== nextPosition) {
        throw new Error(
          `trimVideo: output requires a random-access sink (expected position ${nextPosition}, received ${chunk.position})`,
        )
      }
      await writer.write(chunk.data)
      nextPosition += chunk.data.byteLength
    },
    close,
    abort,
  })

  return { target: new StreamTarget(writable), abort }
}

/** Trim the primary video and audio tracks into a streaming MP4 or WebM output. */
export async function trimVideo(options: TrimVideoOptions): Promise<TrimVideoResult> {
  validateRange(options.startMs, options.endMs)
  if (options.signal?.aborted)
    throw abortError()

  const outputFormat = createOutputFormat(options.format ?? 'mp4')
  const { target, abort } = createAppendOnlyTarget(options.sink)
  const output = new Output({ format: outputFormat, target })
  let input: Input | undefined
  let conversion: Conversion | undefined
  const totalMs = options.endMs - options.startMs
  const onAbort = () => {
    if (conversion)
      void conversion.cancel().catch(() => {})
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    input = new Input({ formats: ALL_FORMATS, source: createSource(options.source) })
    const [sourceDurationSec, videoTrack, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ])
    if (!videoTrack)
      throw new Error('trimVideo: the source has no video track')

    const sourceDurationMs = sourceDurationSec * 1000
    if (!Number.isFinite(sourceDurationMs))
      throw new Error('trimVideo: live or unbounded media is not supported')
    if (options.startMs >= sourceDurationMs || options.endMs > sourceDurationMs) {
      throw new RangeError(
        `trimVideo: range ${options.startMs}-${options.endMs}ms exceeds source duration ${sourceDurationMs}ms`,
      )
    }
    if (options.signal?.aborted)
      throw abortError()

    conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start: options.startMs / 1000, end: options.endMs / 1000 },
      showWarnings: false,
    })
    if (options.signal?.aborted)
      throw abortError()

    const discardedRequiredTrack = conversion.discardedTracks.find(
      ({ track }) => track === videoTrack || track === audioTrack,
    )
    if (discardedRequiredTrack) {
      throw new Error(
        `trimVideo: required ${discardedRequiredTrack.track.type} track was discarded (${discardedRequiredTrack.reason})`,
      )
    }
    if (!conversion.isValid)
      throw new Error('trimVideo: the selected tracks cannot be written to the requested output format')

    conversion.onProgress = (progress, processedTime) => {
      options.onProgress?.({
        progress,
        processedMs: Math.min(totalMs, Math.max(0, processedTime * 1000)),
        totalMs,
      })
    }
    await conversion.execute()

    const outputVideoTrack = output.tracks.find(track => track.isVideoTrack())
    if (!outputVideoTrack)
      throw new Error('trimVideo: conversion completed without a video track')
    const outputAudioTrack = output.tracks.find(track => track.isAudioTrack())

    return {
      sourceStartMs: options.startMs,
      sourceEndMs: options.endMs,
      durationMs: totalMs,
      mimeType: outputFormat.mimeType,
      fileExtension: outputFormat.fileExtension,
      videoMode: outputVideoTrack.source instanceof EncodedVideoPacketSource ? 'copy' : 'transcode',
      ...(outputAudioTrack
        ? { audioMode: outputAudioTrack.source instanceof EncodedAudioPacketSource ? 'copy' as const : 'transcode' as const }
        : {}),
    }
  }
  catch (error) {
    if (conversion)
      await conversion.cancel().catch(() => {})
    await abort(error).catch(() => {})
    if (options.signal?.aborted || error instanceof ConversionCanceledError)
      throw abortError()
    throw error
  }
  finally {
    options.signal?.removeEventListener('abort', onAbort)
    await input?.dispose()
  }
}
