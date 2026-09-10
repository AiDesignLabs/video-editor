/// <reference lib="webworker" />
import type { TranscodeProgress } from '../src/conversion'
import { createMediaProcessor } from '../../assets/src/renditions/media-processor'
import { transcode, validateTranscodedMedia } from '../src/conversion'
import { inspectSdk } from './sdk-diagnostics'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
scope.onmessage = async (event: MessageEvent<{ source: Blob, forceAacExtension?: boolean, assetService?: boolean, cancelAfterProgress?: boolean, diagnostic?: Parameters<typeof inspectSdk>[1] }>) => {
  if (event.data.forceAacExtension) {
    Object.defineProperty(globalThis, 'AudioEncoder', { value: class {
      static async isConfigSupported() { return { supported: false } }
    }, configurable: true })
  }
  const chunks = new Map<string, Uint8Array<ArrayBuffer>[]>()
  const progress: TranscodeProgress[] = []
  try {
    if (event.data.diagnostic) {
      const result = await inspectSdk(event.data.source, event.data.diagnostic)
      scope.postMessage({ files: [result.file, ...result.otherFiles], progress: [], diagnostic: result })
      return
    }
    if (event.data.assetService) {
      const controller = new AbortController()
      const files = await createMediaProcessor().process({ source: new File([event.data.source], 'source.mov'), profiles: [96, 48].map(height => ({ id: `profile-${height}`, container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', audioBitrate: 192_000, videoBitrate: 300_000, maxShortSide: height, keyFrameIntervalMs: 1000 })), signal: controller.signal, onProgress(value) {
        progress.push(value)
        if (event.data.cancelAfterProgress && value.ratio > 0)
          controller.abort()
      } })
      scope.postMessage({ files: files.map(item => item.file), progress })
      return
    }
    const result = await transcode({
      source: event.data.source,
      renditions: [{ id: 'master', height: 96, videoBitrate: 300_000 }, { id: 'proxy', height: 48, videoBitrate: 100_000 }],
      audioBitrate: 192_000,
      openSink(rendition) {
        const data: Uint8Array<ArrayBuffer>[] = []
        chunks.set(rendition.id, data)
        return new WritableStream({ write(chunk) {
          data.push(new Uint8Array(chunk))
        } })
      },
      async validateOutput(rendition) {
        await validateTranscodedMedia(new Blob(chunks.get(rendition.id)), rendition)
      },
      onProgress: value => progress.push(value),
    })
    scope.postMessage({ result, progress, files: result.renditions.map(item => new Blob(chunks.get(item.id), { type: 'video/mp4' })) })
  }
  catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
