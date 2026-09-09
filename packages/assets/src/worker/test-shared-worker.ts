import { attachAssetWorkerPort, createAssetWorkerRuntime } from './index'

const runtime = createAssetWorkerRuntime({ cacheNamespace: 'browser-shared-test', workerBuildId: 'test' })

globalThis.addEventListener('connect', (event) => {
  if (!(event instanceof MessageEvent))
    return
  const port = event.ports[0]
  if (!port)
    return
  void runtime.then(value => attachAssetWorkerPort(value, port)).catch((error: unknown) => {
    port.postMessage({ type: 'error', requestId: 'hello', code: 'ASSET_WORKER_INITIALIZATION_FAILED', message: error instanceof Error ? error.message : String(error) })
  })
})
