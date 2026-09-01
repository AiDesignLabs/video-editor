/**
 * Instrumentation around `@video-editor/media`'s `transcode()`.
 *
 * The transcode itself lives in the package — this file only adds what a
 * measurement harness needs and a library should not have: OPFS output files,
 * heap sampling, and re-reading each output to check the key-frame interval the
 * encoder actually produced.
 */
import type { CodecSupportProbe, DecoderOptions, EncoderThroughput, Rendition, TranscodeStages, VideoStats } from '@video-editor/media'
import { measureDecodeThroughput, measureEncoderThroughput, openMediaInput, probeCodecSupport, probeVideoStats, transcode } from '@video-editor/media'

export type { CodecSupportProbe }
export { probeCodecSupport }

/** Named so several runs do not fight over one file. */
function outputFileName(renditionId: string) {
  return `transcode-lab-${renditionId}.mp4`
}

/**
 * An OPFS file as the transcode's sink, so the output never sits in the JS
 * heap — and the same shape shipping code would use: write the rendition to
 * OPFS, then upload from there.
 */
async function openOutputFile(renditionId: string) {
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(outputFileName(renditionId), { create: true })
  return { handle, writable: await handle.createWritable() }
}

export interface RenditionSpec extends Rendition {
  label: string
}

export interface SourceInfo extends VideoStats {
  durationSec: number
  width: number
  height: number
  sizeBytes: number
}

export interface RenditionOutput {
  spec: RenditionSpec
  /** Frames bypassed the canvas for this rendition. */
  passthrough: boolean
  /** The WebCodecs config the encoder was created with, if mediabunny reported it. */
  encoderConfig?: VideoEncoderConfig
  sizeBytes: number
  width: number
  height: number
  /** Frames in the produced file; fewer than the source means the encoder dropped some. */
  frameCount: number
  keyFrameCount: number
  /** Measured from the produced file, not the requested setting. */
  gopSec: number | null
  blob: Blob
}

export interface LabResult {
  source: SourceInfo
  outputs: RenditionOutput[]
  timing: {
    totalMs: number
    /** Source frames processed per second — with N renditions this is the decode rate. */
    fps: number
    /** How many times faster than real time; below 1 means slower than playback. */
    realtimeFactor: number
  }
  /** Chrome-only JS heap peak. Excludes decoder/GPU memory — see the UI note. */
  heapPeakBytes: number | null
  /**
   * Heap once the run has finished and garbage has had a chance to be
   * collected. `usedJSHeapSize` counts unreclaimed garbage, so the peak above is
   * the top of a sawtooth; this approximates the live set.
   */
  heapSettledBytes: number | null
  /** Absent for decode-only runs. */
  stages?: TranscodeStages
  /** Present for raw-WebCodecs encode runs. */
  encodeProbe?: EncoderThroughput
}

export interface LabProgress {
  framesDone: number
  framesTotal: number
  elapsedMs: number
}

/** Knobs the lab lets you A/B; all of them are hints passed straight through. */
export type AccelerationHint = 'no-preference' | 'prefer-hardware' | 'prefer-software'

export interface LabHints {
  /** Applied to the decoder and every encoder. */
  hardwareAcceleration: AccelerationHint
  /** Applied to every encoder. Faster, but may drop frames. */
  realtimeEncoding: boolean
  /** Await the preview encoder before the proxy one; isolates whether a wait belongs to one encoder or is shared. */
  previewFirst: boolean
  /** Same-size renditions take the decoded frame directly, skipping the canvas. */
  passthroughSameSize: boolean
  /** Outstanding `addFrame()` calls allowed per rendition; 1 = await every call (mediabunny's muxing on the critical path). */
  pipelineDepth: number
}

interface ChromeMemory { usedJSHeapSize: number }

function readHeap(): number | null {
  const memory = (performance as Performance & { memory?: ChromeMemory }).memory
  return memory ? memory.usedJSHeapSize : null
}

export async function inspectSource(file: File): Promise<SourceInfo> {
  const handle = openMediaInput(file)
  try {
    if (!(await handle.canDecodeVideo()))
      throw new Error('浏览器无法解码这个视频轨（编码不受支持）')

    const meta = await handle.meta()
    const stats = await probeVideoStats(file)
    if (!stats)
      throw new Error('这个文件里没有视频轨')

    return {
      ...stats,
      durationSec: meta.durationMs / 1000,
      width: meta.width,
      height: meta.height,
      sizeBytes: file.size,
    }
  }
  finally {
    handle.dispose()
  }
}

function decoderHints(hints: LabHints): DecoderOptions | undefined {
  return hints.hardwareAcceleration === 'no-preference' ? undefined : { hardwareAcceleration: hints.hardwareAcceleration }
}

/**
 * The same pull loop `transcode()` runs, with no encoders attached. If this
 * lands near the full run's throughput the decoder is the ceiling; if it is
 * far above, the per-frame draw/encode stage is what to optimise.
 */
export async function runDecodeOnly(
  file: File,
  hints: LabHints,
  onProgress: (progress: LabProgress) => void,
  signal: AbortSignal,
): Promise<LabResult> {
  const source = await inspectSource(file)
  const startedAt = performance.now()
  let heapPeak = readHeap()

  const throughput = await measureDecodeThroughput(file, {
    decoder: decoderHints(hints),
    signal,
    onProgress({ framesDone, framesTotal }) {
      if (framesDone % 30 !== 0)
        return
      const heap = readHeap()
      if (heap !== null && (heapPeak === null || heap > heapPeak))
        heapPeak = heap
      onProgress({ framesDone, framesTotal, elapsedMs: performance.now() - startedAt })
    },
  })

  await new Promise(resolve => setTimeout(resolve, 500))

  return {
    source,
    outputs: [],
    timing: {
      totalMs: throughput.ms,
      fps: throughput.fps,
      realtimeFactor: throughput.ms > 0 ? (source.durationSec * 1000) / throughput.ms : 0,
    },
    heapPeakBytes: heapPeak,
    heapSettledBytes: readHeap(),
  }
}

export interface EncodeProbeSettings {
  height: number
  videoBitrateKbps: number
  keyFrameIntervalSec: number
  maxQueue: number
  framerate: number
}

/** The encode leg on raw WebCodecs — see `measureEncoderThroughput`. */
export async function runEncodeOnly(
  file: File,
  settings: EncodeProbeSettings,
  hints: LabHints,
  onProgress: (progress: LabProgress) => void,
  signal: AbortSignal,
): Promise<LabResult> {
  const source = await inspectSource(file)
  const startedAt = performance.now()
  let heapPeak = readHeap()

  const probe = await measureEncoderThroughput(file, {
    height: settings.height,
    videoBitrate: settings.videoBitrateKbps * 1000,
    keyFrameIntervalMs: settings.keyFrameIntervalSec * 1000,
    maxQueue: settings.maxQueue,
    framerate: settings.framerate,
    ...(hints.realtimeEncoding ? { latencyMode: 'realtime' as const } : {}),
    ...(hints.hardwareAcceleration === 'no-preference' ? {} : { hardwareAcceleration: hints.hardwareAcceleration }),
    decoder: decoderHints(hints),
    signal,
    onProgress({ framesDone, framesTotal }) {
      if (framesDone % 30 !== 0)
        return
      const heap = readHeap()
      if (heap !== null && (heapPeak === null || heap > heapPeak))
        heapPeak = heap
      onProgress({ framesDone, framesTotal, elapsedMs: performance.now() - startedAt })
    },
  })

  await new Promise(resolve => setTimeout(resolve, 500))
  return {
    source,
    outputs: [],
    timing: {
      totalMs: probe.ms,
      fps: probe.fps,
      realtimeFactor: probe.ms > 0 ? (source.durationSec * 1000) / probe.ms : 0,
    },
    heapPeakBytes: heapPeak,
    heapSettledBytes: readHeap(),
    encodeProbe: probe,
  }
}

export async function runLab(
  file: File,
  specs: RenditionSpec[],
  hints: LabHints,
  onProgress: (progress: LabProgress) => void,
  signal: AbortSignal,
): Promise<LabResult> {
  const source = await inspectSource(file)

  const files = new Map<string, FileSystemFileHandle>()
  const startedAt = performance.now()
  let heapPeak = readHeap()

  const ordered = hints.previewFirst ? [...specs].reverse() : specs
  const transcodeResult = await transcode({
    source: file,
    renditions: ordered.map(spec => ({
      ...spec,
      ...(hints.hardwareAcceleration === 'no-preference' ? {} : { hardwareAcceleration: hints.hardwareAcceleration }),
      ...(hints.realtimeEncoding ? { latencyMode: 'realtime' as const } : {}),
    })),
    decoder: decoderHints(hints),
    passthroughSameSize: hints.passthroughSameSize,
    pipelineDepth: hints.pipelineDepth,
    async openSink(rendition) {
      const { handle, writable } = await openOutputFile(rendition.id)
      files.set(rendition.id, handle)
      return writable
    },
    onProgress({ framesDone, framesTotal }) {
      // Sampling every frame would itself distort the measurement.
      if (framesDone % 30 !== 0)
        return
      const heap = readHeap()
      if (heap !== null && (heapPeak === null || heap > heapPeak))
        heapPeak = heap
      onProgress({ framesDone, framesTotal, elapsedMs: performance.now() - startedAt })
    },
    signal,
  })

  // Stop the clock here: reading the outputs back is the lab's own bookkeeping,
  // not something a shipping transcode would make the user wait for.
  const totalMs = performance.now() - startedAt

  const outputs: RenditionOutput[] = []
  for (const spec of specs) {
    const handle = files.get(spec.id)
    if (!handle)
      continue

    // An OPFS-backed File, not an in-memory Blob.
    const blob = await handle.getFile()
    if (blob.size === 0)
      throw new Error(`${spec.label}: 编码结束但没有产出数据`)

    const stats = await probeVideoStats(blob)
    const height = Math.max(2, Math.round(spec.height / 2) * 2)
    outputs.push({
      spec,
      passthrough: transcodeResult.renditions.find(r => r.id === spec.id)?.passthrough ?? false,
      encoderConfig: transcodeResult.renditions.find(r => r.id === spec.id)?.encoderConfig,
      sizeBytes: blob.size,
      width: Math.max(2, Math.round((source.width * (height / source.height)) / 2) * 2),
      height,
      frameCount: stats?.frameCount ?? 0,
      keyFrameCount: stats?.keyFrameCount ?? 0,
      gopSec: stats?.gopSec ?? null,
      blob,
    })
  }

  // Give the collector an opening before reading the settled value. Not a
  // guarantee — page script cannot force a GC — so treat it as an upper bound.
  await new Promise(resolve => setTimeout(resolve, 500))

  return {
    source,
    outputs,
    timing: {
      totalMs,
      fps: totalMs > 0 ? (source.frameCount / totalMs) * 1000 : 0,
      realtimeFactor: totalMs > 0 ? (source.durationSec * 1000) / totalMs : 0,
    },
    heapPeakBytes: heapPeak,
    heapSettledBytes: readHeap(),
    stages: transcodeResult.stages,
  }
}
