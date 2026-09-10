import type { SdkDiagnosticMode } from './sdk-diagnostics'
import type { ExperimentMode, ExperimentResult } from './shared-decode-experiment'
import ConversionWorker from './conversion-worker?worker'
import ExperimentWorker from './shared-decode-experiment-worker?worker'

declare global {
  interface Window {
    convertMedia: typeof convert
    runMediaExperiment: (source: File, mode: ExperimentMode) => Promise<ExperimentResult>
  }
}

export async function convert(source: Blob, forceAacExtension = false, assetService = false, cancelAfterProgress = false, diagnostic?: SdkDiagnosticMode) {
  const worker = new ConversionWorker()
  try {
    return await new Promise<{ files: Blob[], progress: Array<{ ratio: number }>, error?: string, diagnostic?: { decoders: number, decodedPackets: number, timing: Record<string, number>, audioCopied: boolean } }>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data)
      worker.onerror = event => reject(new Error(event.message))
      worker.postMessage({ source, forceAacExtension, assetService, cancelAfterProgress, diagnostic })
    })
  }
  finally {
    worker.terminate()
  }
}

window.convertMedia = convert
window.runMediaExperiment = async (source, mode) => {
  const worker = new ExperimentWorker()
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ result: ExperimentResult, error?: string }>) => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result)
      worker.onerror = event => reject(new Error(event.message))
      worker.postMessage([source, mode])
    })
  }
  finally { worker.terminate() }
}
