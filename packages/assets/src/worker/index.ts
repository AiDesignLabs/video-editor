/* eslint-disable style/max-statements-per-line */
import type { AssetWorkerHello, AssetWorkerRequest, AssetWorkerResponse, AssetWorkerResult } from '../protocol/messages'
import type { AssetWorkerRuntimeOptions } from './runtime'
import { ASSET_PROTOCOL_VERSION } from '../protocol/messages'
import { AssetWorkerRuntime } from './runtime'

export { AssetWorkerRuntime } from './runtime'
export type { AssetWorkerRuntimeOptions } from './runtime'

export async function createAssetWorkerRuntime(options: AssetWorkerRuntimeOptions) {
  const runtime = new AssetWorkerRuntime(options)
  await runtime.initialize()
  return runtime
}

export function attachAssetWorkerPort(runtime: AssetWorkerRuntime, port: MessagePort) {
  let sessionToken: string | undefined
  const unsubscribe = runtime.subscribe(event => port.postMessage({ type: 'event', event } satisfies AssetWorkerResponse))
  port.addEventListener('message', (message: MessageEvent<AssetWorkerHello | AssetWorkerRequest>) => {
    void handle(message.data).catch((error: unknown) => {
      const requestId = 'requestId' in message.data ? message.data.requestId : 'hello'
      port.postMessage({ type: 'error', requestId, code: errorCode(error), message: error instanceof Error ? error.message : String(error) } satisfies AssetWorkerResponse)
    })
  })
  port.start()

  async function handle(message: AssetWorkerHello | AssetWorkerRequest) {
    if (message.type === 'hello') {
      if (message.protocolVersion !== ASSET_PROTOCOL_VERSION)
        throw Object.assign(new Error('Asset worker protocol version does not match.'), { code: 'PROTOCOL_VERSION_MISMATCH' })
      if (message.expectedCacheNamespace !== runtime.cacheNamespace)
        throw Object.assign(new Error('Asset worker cache namespace does not match.'), { code: 'CACHE_NAMESPACE_MISMATCH' })
      sessionToken = crypto.randomUUID()
      port.postMessage({ type: 'hello-ack', requestId: 'hello', ack: { protocolVersion: 1, cacheNamespace: message.expectedCacheNamespace, cacheGeneration: runtime.getGeneration(), runtimeInstanceId: runtime.runtimeInstanceId, workerBuildId: runtime.workerBuildId, clientSessionToken: sessionToken, capabilities: runtime.getCapabilities() } } satisfies AssetWorkerResponse)
      return
    }
    if (!sessionToken || message.clientSessionToken !== sessionToken)
      throw Object.assign(new Error('Asset worker client session is invalid.'), { code: 'ASSET_CLIENT_SESSION_INVALID' })
    if (message.operation.type !== 'clear-cache' && message.cacheGeneration !== runtime.getGeneration())
      throw Object.assign(new Error('Asset cache generation changed; reconnect the client.'), { code: 'ASSET_CACHE_GENERATION_CHANGED' })
    const operation = message.operation
    let result: AssetWorkerResult
    switch (operation.type) {
      case 'upsert-asset': result = await runtime.upsertAsset(operation.asset, operation.variants); break
      case 'resolve': result = await runtime.resolve(operation.request); break
      case 'ensure-cached': result = await runtime.ensureCached(operation.request); break
      case 'cache-local': result = await runtime.cacheLocal(operation.asset, operation.variant, operation.file); break
      case 'get-cache-status': result = await runtime.getCacheStatus(operation.ref); break
      case 'get-job-status': result = await runtime.getJobStatus(operation.jobId); break
      case 'renew': result = await runtime.renew(operation.leaseId); break
      case 'release': result = runtime.release(operation.leaseId); break
      case 'sweep': result = await runtime.sweep(); break
      case 'clear-cache': result = await runtime.clearCache(); break
      case 'stage-upload': result = await runtime.stageUpload(operation.job, operation.file); break
      case 'list-upload-jobs': result = await runtime.listUploadJobs(); break
      case 'get-upload-job': result = await runtime.getUploadJob(operation.jobId); break
      case 'put-upload-job': result = await runtime.putUploadJob(operation.job); break
      case 'get-upload-payload': result = await runtime.getUploadPayload(operation.jobId); break
      case 'list-upload-sessions': result = await runtime.listUploadSessions(operation.jobId); break
      case 'put-upload-session': result = await runtime.putUploadSession(operation.session); break
      case 'delete-upload': result = await runtime.deleteUpload(operation.jobId); break
      case 'close':
        unsubscribe()
        result = runtime.close()
        break
    }
    port.postMessage({ type: 'response', requestId: message.requestId, result } satisfies AssetWorkerResponse)
  }
  return () => { unsubscribe(); port.close() }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'ASSET_WORKER_ERROR'
}
