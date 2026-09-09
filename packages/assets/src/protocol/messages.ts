import type { UploadJobRecord, UploadSessionRecord } from '../storage/database'
import type { AssetCacheReport, AssetCacheSnapshot, AssetCapabilities, AssetEvent, AssetJobSnapshot, AssetRecord, AssetVariantRecord, CacheAssetRequest, ResolveAssetRequest, ResolvedAsset } from '../types'

export const ASSET_PROTOCOL_VERSION = 1

export interface AssetWorkerHello {
  type: 'hello'
  protocolVersion: 1
  clientId: string
  expectedCacheNamespace: string
}
export interface AssetWorkerHelloAck {
  protocolVersion: 1
  cacheNamespace: string
  cacheGeneration: number
  runtimeInstanceId: string
  workerBuildId: string
  clientSessionToken: string
  capabilities: AssetCapabilities
}
export type AssetWorkerOperation
  = | { type: 'upsert-asset', asset: AssetRecord, variants: readonly AssetVariantRecord[] }
    | { type: 'resolve', request: ResolveAssetRequest }
    | { type: 'ensure-cached', request: CacheAssetRequest }
    | { type: 'cache-local', asset: AssetRecord, variant: AssetVariantRecord, file: File }
    | { type: 'get-cache-status', ref: ResolveAssetRequest['ref'] }
    | { type: 'get-job-status', jobId: string }
    | { type: 'renew', leaseId: string }
    | { type: 'release', leaseId: string }
    | { type: 'sweep' }
    | { type: 'clear-cache' }
    | { type: 'stage-upload', job: UploadJobRecord, file: File }
    | { type: 'list-upload-jobs' }
    | { type: 'get-upload-job', jobId: string }
    | { type: 'put-upload-job', job: UploadJobRecord }
    | { type: 'get-upload-payload', jobId: string }
    | { type: 'list-upload-sessions', jobId: string }
    | { type: 'put-upload-session', session: UploadSessionRecord }
    | { type: 'delete-upload', jobId: string }
    | { type: 'close' }
export interface AssetWorkerRequest {
  type: 'request'
  requestId: string
  cacheGeneration: number
  clientSessionToken: string
  operation: AssetWorkerOperation
}
export type AssetWorkerResult = void | ResolvedAsset | AssetJobSnapshot | AssetJobSnapshot | AssetCacheSnapshot | AssetCacheReport | UploadJobRecord | readonly UploadJobRecord[] | UploadSessionRecord | readonly UploadSessionRecord[] | File
export type AssetWorkerResponse
  = | { type: 'hello-ack', requestId: string, ack: AssetWorkerHelloAck }
    | { type: 'response', requestId: string, result: AssetWorkerResult }
    | { type: 'error', requestId: string, code: string, message: string }
    | { type: 'event', event: AssetEvent }
