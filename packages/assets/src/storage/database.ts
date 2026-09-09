import type { DBSchema, IDBPDatabase } from 'idb'
import type { AssetCacheStatus, AssetIngestPolicy, AssetJobKind, AssetJobStatus, AssetRecord, AssetVariantRecord, ContentDigest, UploadedVariant } from '../types'
import { openDB } from 'idb'

export const ASSET_DATABASE_NAME = 'video-editor-assets'
export const ASSET_DATABASE_VERSION = 1

export interface StoredAssetRecord extends AssetRecord { cacheNamespace: string }
export interface StoredAssetVariantRecord extends AssetVariantRecord { cacheNamespace: string }
export interface AssetDownloadCheckpoint {
  totalBytes: number
  downloadedBytes: number
  etag?: string
  lastModified?: string
  chunks: Array<{ path: string, size: number }>
  pendingPath?: string
}
export interface AssetCacheEntry {
  download?: AssetDownloadCheckpoint
  cacheKey: string
  cacheNamespace: string
  assetId: string
  sourceRevision: number
  variantId: string
  opfsPath: string
  status: AssetCacheStatus
  writerEpoch: number
  writerTokenHash?: string
  writerLeaseUntil?: number
  leaseProtectionUntil?: number
  sizeBytes?: number
  retryCount: number
  createdAt: number
  updatedAt: number
  lastAccessAt: number
  evictAfter: number
  failureCode?: string
}
export interface AssetJobRecord {
  cacheNamespace: string
  jobId: string
  kind: AssetJobKind
  dedupeKey: string
  status: AssetJobStatus
  phase?: string
  progress?: number
  errorCode?: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
}
export interface UploadJobRecord {
  cacheNamespace: string
  jobId: string
  adapterId: string
  checkpointVersion: number
  accessRef: string
  continuationRef: string
  ownerEpoch: number
  policy: AssetIngestPolicy
  businessStatus: 'preparing' | 'staging-source' | 'uploading-source' | 'processing-compatibility' | 'uploading-compatibility' | 'awaiting-business-commit' | 'committed' | 'paused' | 'failed' | 'cancelled'
  optimizationStatus: 'not-planned' | 'queued' | 'running' | 'paused' | 'succeeded' | 'succeeded-with-errors' | 'cancelled'
  sourceName: string
  sourceSizeBytes: number
  sourceDigest?: ContentDigest
  sourceStaging?: { opfsPath: string, status: 'writing' | 'ready' }
  source?: Omit<UploadedVariant, 'url' | 'existingVariants'>
  result?: {
    status: 'ready'
    source: Omit<UploadedVariant, 'url' | 'existingVariants'>
    playback: Omit<UploadedVariant, 'url' | 'existingVariants'>
    availableVariants: readonly Omit<UploadedVariant, 'url' | 'existingVariants'>[]
    optimizationJobId?: string
  }
  createdAt: number
  updatedAt: number
  retainUntil: number
}
export interface UploadSessionRecord {
  cacheNamespace: string
  uploadId: string
  jobId: string
  adapterId: string
  checkpointVersion: number
  relation: { kind: 'source' } | { kind: 'variant', sourceRemoteFileId: string, profileId: string }
  resumeToken?: string
  payloadOpfsPath: string
  payloadName: string
  payloadSizeBytes: number
  metadata: { contentType: string, sizeBytes: number, width?: number, height?: number, durationMs?: number }
  partSizeBytes?: number
  completedParts: readonly { partNumber: number, sizeBytes: number, receipt: string }[]
  status: 'staging' | 'preparing' | 'uploading' | 'paused' | 'completing' | 'completed' | 'expired' | 'failed'
  createdAt: number
  updatedAt: number
  retainUntil: number
}
export interface AssetSettingRecord {
  cacheNamespace: string
  cacheGeneration: number
  policyVersion: number
  lastFullScanAt?: number
}

interface AssetDatabaseSchema extends DBSchema {
  assetRecords: { key: [string, string], value: StoredAssetRecord, indexes: { byNamespaceUpdatedAt: [string, number] } }
  variantRecords: {
    key: [string, string, number, string]
    value: StoredAssetVariantRecord
    indexes: { byAssetRevision: [string, string, number], byProfile: [string, string, number, string] }
  }
  cacheEntries: {
    key: string
    value: AssetCacheEntry
    indexes: { byRef: [string, string, number, string], byStatusUpdatedAt: [string, AssetCacheStatus, number], byLastAccessAt: [string, number], byEvictAfter: [string, number] }
  }
  jobs: { key: [string, string], value: AssetJobRecord, indexes: { byNamespaceUpdatedAt: [string, number] } }
  uploadJobs: { key: [string, string], value: UploadJobRecord, indexes: { byNamespaceUpdatedAt: [string, number] } }
  uploadSessions: { key: [string, string], value: UploadSessionRecord, indexes: { byJob: [string, string] } }
  settings: { key: string, value: AssetSettingRecord }
}

export type AssetDatabase = IDBPDatabase<AssetDatabaseSchema>

export function openAssetDatabase(): Promise<AssetDatabase> {
  return openDB<AssetDatabaseSchema>(ASSET_DATABASE_NAME, ASSET_DATABASE_VERSION, {
    upgrade(database) {
      const assets = database.createObjectStore('assetRecords', { keyPath: ['cacheNamespace', 'assetId'] })
      assets.createIndex('byNamespaceUpdatedAt', ['cacheNamespace', 'updatedAt'])
      const variants = database.createObjectStore('variantRecords', { keyPath: ['cacheNamespace', 'assetId', 'sourceRevision', 'variantId'] })
      variants.createIndex('byAssetRevision', ['cacheNamespace', 'assetId', 'sourceRevision'])
      variants.createIndex('byProfile', ['cacheNamespace', 'assetId', 'sourceRevision', 'profileId'])
      const cache = database.createObjectStore('cacheEntries', { keyPath: 'cacheKey' })
      cache.createIndex('byRef', ['cacheNamespace', 'assetId', 'sourceRevision', 'variantId'], { unique: true })
      cache.createIndex('byStatusUpdatedAt', ['cacheNamespace', 'status', 'updatedAt'])
      cache.createIndex('byLastAccessAt', ['cacheNamespace', 'lastAccessAt'])
      cache.createIndex('byEvictAfter', ['cacheNamespace', 'evictAfter'])
      const jobs = database.createObjectStore('jobs', { keyPath: ['cacheNamespace', 'jobId'] })
      jobs.createIndex('byNamespaceUpdatedAt', ['cacheNamespace', 'updatedAt'])
      const uploadJobs = database.createObjectStore('uploadJobs', { keyPath: ['cacheNamespace', 'jobId'] })
      uploadJobs.createIndex('byNamespaceUpdatedAt', ['cacheNamespace', 'updatedAt'])
      const sessions = database.createObjectStore('uploadSessions', { keyPath: ['cacheNamespace', 'uploadId'] })
      sessions.createIndex('byJob', ['cacheNamespace', 'jobId'])
      database.createObjectStore('settings', { keyPath: 'cacheNamespace' })
    },
  })
}
