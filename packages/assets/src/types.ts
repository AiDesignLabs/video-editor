export type AssetKind = 'video' | 'audio' | 'image' | 'other'
export type AssetPriority = 'interactive' | 'background'
export interface ContentDigest { algorithm: 'md5' | 'sha-256', value: string }

export interface AssetRef { assetId: string, sourceRevision: number }
export interface AssetVariantRef extends AssetRef { variantId: string }
export interface AssetRecord extends AssetRef {
  kind: AssetKind
  name?: string
  createdAt: number
  updatedAt: number
}
export interface AssetVariantRecord extends AssetVariantRef {
  profileId?: string
  remoteFileId?: string
  remoteRecovery: 'host-refreshable' | 'none'
  contentType?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationMs?: number
  contentDigest?: ContentDigest
  createdAt: number
  updatedAt: number
}
export type AssetCacheStatus = 'downloading' | 'writing' | 'ready' | 'failed'
export type AssetJobKind = 'cache' | 'derivation' | 'upload'
export type AssetJobStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'succeeded-with-errors' | 'failed' | 'cancelled' | 'interrupted'
export interface AssetCapabilities {
  mode: 'shared-cache' | 'url-only'
  sharedWorker: boolean
  indexedDB: boolean
  opfs: boolean
  mediaProcessing: boolean
  persistentStorage: boolean
  resumableUpload: boolean
}
export interface AssetProfileJobSnapshot {
  profileId: string
  status: 'queued' | 'processing' | 'uploading' | 'ready' | 'failed' | 'cancelled'
  progress?: number
  attemptCount: number
  errorCode?: string
}
export interface AssetJobSnapshot {
  uploadPlan?: { compatibilityProfileId?: string, profiles: readonly { profileId: string, shortSide: number }[] }
  jobId: string
  kind: AssetJobKind
  status: AssetJobStatus
  phase?: string
  progress?: number
  errorCode?: string
  profileStatuses?: readonly AssetProfileJobSnapshot[]
  updatedAt: number
}
export interface AssetCacheSnapshot {
  ref: AssetVariantRef
  status: AssetCacheStatus | 'not-cached'
  sizeBytes?: number
  lastAccessAt?: number
  evictAfter?: number
  failureCode?: string
}
export interface AssetCacheReport {
  reason: 'scheduled' | 'quota-pressure' | 'quota-error' | 'explicit'
  removedEntries: number
  removedBytes: number
  retainedLeaseEntries: number
  trackedBytes: number
}
export type AssetEvent
  = | { type: 'job-updated', job: AssetJobSnapshot }
    | { type: 'cache-updated', cache: AssetCacheSnapshot }
    | { type: 'cache-clearing' }
export interface ResolveAssetRequest {
  ref: AssetVariantRef
  fallbackUrl?: string
  cacheOnMiss?: boolean
  priority?: AssetPriority
}
export interface CacheAssetRequest { ref: AssetVariantRef, url: string, priority?: AssetPriority }
export type ResolvedAsset = { source: 'opfs', file: File, leaseId: string } | { source: 'url', url: string }
export interface AssetUrlHandle { url: string, source: 'opfs' | 'url', release: () => void }
export interface RemoteVariantLocation { url: string, urlExpiresAt?: number }
export interface VideoRenditionProfile {
  id: string
  container: 'mp4'
  videoCodec: 'avc'
  audioCodec: 'aac'
  maxShortSide: number
  videoBitrate: number
  audioBitrate: number
  keyFrameIntervalMs: number
}
export interface AssetIngestPolicy {
  compatibilityProfileId?: string
  requiredProfileIds?: readonly string[]
  optimizationProfileIds?: readonly string[]
  maxOptimizationAttemptsPerProfile: number
  cacheSource: boolean
  cacheProducedVariants: boolean
}
export interface UploadAssetRequest<TContext = unknown> {
  file: File
  policy: AssetIngestPolicy
  context: TContext
  resumeAcrossReloads?: boolean
  continuationRef?: string
}
export interface UploadVariantRequest<TContext = unknown> {
  file: File
  fileName: string
  resumeAcrossReloads: boolean
  knownContentDigest?: ContentDigest
  relation: { kind: 'source' } | { kind: 'variant', sourceRemoteFileId: string, profileId: string }
  metadata: { contentType: string, sizeBytes: number, width?: number, height?: number, durationMs?: number }
  context: TContext
  signal: AbortSignal
  onProgress: (ratio: number | null) => void
}
export interface RemoteVariantDescriptor {
  remoteFileId: string
  profileId?: string
  url: string
  storageLocation?: string
  urlExpiresAt?: number
  contentType?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationMs?: number
  contentDigest?: ContentDigest
}
export interface UploadedVariant extends RemoteVariantDescriptor { existingVariants?: readonly RemoteVariantDescriptor[] }
export type UploadPreparation<TPrepared = unknown>
  = | { kind: 'already-uploaded', uploaded: UploadedVariant, accessRef?: string }
    | { kind: 'direct', prepared: TPrepared }
    | { kind: 'resumable', prepared: TPrepared, accessRef: string, contentDigest?: ContentDigest }
export interface UploadedPartReceipt { partNumber: number, sizeBytes: number, receipt: string }
export interface RemoteUploadSession { resumeToken: string, partSizeBytes: number, expiresAt?: number }
export interface ResumableUploadPort<TContext = unknown, TPrepared = unknown> {
  createSession: (request: { uploadId: string, upload: UploadVariantRequest<TContext>, prepared: TPrepared }) => Promise<RemoteUploadSession>
  inspectSession: (request: { resumeToken: string, context: TContext, signal: AbortSignal }) => Promise<{ status: 'uploading' | 'finalizing', completedParts: readonly UploadedPartReceipt[] } | { status: 'completed', uploaded: UploadedVariant } | { status: 'expired' | 'not-accessible' }>
  uploadPart: (request: { resumeToken: string, partNumber: number, offset: number, bytes: Blob, context: TContext, signal: AbortSignal }) => Promise<UploadedPartReceipt>
  completeSession: (request: { resumeToken: string, completedParts: readonly UploadedPartReceipt[], descriptor: { fileName: string, relation: UploadVariantRequest<TContext>['relation'], metadata: UploadVariantRequest<TContext>['metadata'], contentDigest?: ContentDigest }, context: TContext, signal: AbortSignal }) => Promise<UploadedVariant>
  abortSession: (request: { resumeToken: string, context: TContext, signal: AbortSignal }) => Promise<void>
}
export interface UploadedAssetResult {
  jobId: string
  status: 'ready'
  source: UploadedVariant
  playback: UploadedVariant
  availableVariants: readonly UploadedVariant[]
  optimizationJobId?: string
}
export interface AssetOptimizationResult {
  jobId: string
  status: 'succeeded' | 'succeeded-with-errors' | 'cancelled'
  readyProfileIds: readonly string[]
  failedProfileIds: readonly string[]
}
export interface RecoverableUploadSummary {
  jobId: string
  continuationRef: string
  businessStatus: 'preparing' | 'staging-source' | 'uploading-source' | 'processing-compatibility' | 'uploading-compatibility' | 'awaiting-business-commit' | 'committed' | 'paused' | 'failed' | 'cancelled'
  updatedAt: number
  retainUntil: number
}
export interface ResumeUploadRequest<TContext = unknown> { jobId: string, context: TContext }
export interface RetryOptimizationProfilesRequest<TContext = unknown> { jobId: string, profileIds: readonly string[], context: TContext }
export interface UploadCheckpointRequest<TContext = unknown> { jobId: string, context: TContext }
export interface CancelOptimizationRequest<TContext = unknown> { jobId: string, context: TContext }
export interface AssetTask<TResult> {
  readonly jobId: string
  readonly result: Promise<TResult>
  subscribe: (listener: (snapshot: AssetJobSnapshot) => void) => () => void
  cancel: () => Promise<void>
}
