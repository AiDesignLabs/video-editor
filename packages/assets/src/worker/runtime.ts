/* eslint-disable style/max-statements-per-line */
import type { AssetCacheEntry, AssetDatabase, StoredAssetVariantRecord, UploadJobRecord, UploadSessionRecord } from '../storage/database'
import type { AssetCacheReport, AssetCacheSnapshot, AssetCacheStatus, AssetCapabilities, AssetEvent, AssetJobSnapshot, AssetRecord, AssetVariantRecord, CacheAssetRequest, ResolveAssetRequest, ResolvedAsset } from '../types'
import { createCacheKey, getCacheObjectPath } from '../cache/key'
import { AssetError, AssetPersistenceUnavailableError, AssetUnavailableError } from '../errors'
import { createAssetFileStore } from '../storage/asset-file-store'
import { openAssetDatabase } from '../storage/database'
import { AssetDownloadHttpError, downloadResumable } from './resumable-download'

const DAY = 86_400_000
const WRITER_LEASE_MS = 60_000
const FILE_LEASE_MS = 90_000

export interface AssetWorkerRuntimeOptions {
  cacheNamespace: string
  workerBuildId?: string
  now?: () => number
  fetch?: typeof fetch
  cacheBudgetBytes?: number
  maxConcurrentDownloads?: number
  maxConcurrentBackgroundDownloads?: number
  writerLeaseMs?: number
  downloadChunkSizeBytes?: number
  legacyResourceDirectory?: string
}

interface WriterClaim {
  entry: AssetCacheEntry
  generation: number
  tokenHash: string
}

type WriterClaimResult
  = | { status: 'acquired', claim: WriterClaim }
    | { status: 'ready', entry: AssetCacheEntry }
    | { status: 'waiting', leaseUntil: number }

interface ScheduledDownload {
  cacheKey: string
  request: CacheAssetRequest
  priority: NonNullable<CacheAssetRequest['priority']>
  started: boolean
  promise: Promise<AssetJobSnapshot>
  resolve: (snapshot: AssetJobSnapshot) => void
  reject: (error: unknown) => void
}

export class AssetWorkerRuntime {
  readonly runtimeInstanceId = crypto.randomUUID()
  readonly workerBuildId: string
  private readonly now: () => number
  private readonly fetcher: typeof fetch
  private readonly maxConcurrentDownloads: number
  private readonly maxConcurrentBackgroundDownloads: number
  private readonly writerLeaseMs: number
  private readonly files = createAssetFileStore()
  private readonly inflightByCacheKey = new Map<string, ScheduledDownload>()
  private readonly downloadQueue: ScheduledDownload[] = []
  private readonly leases = new Map<string, { cacheKey: string, expiresAt: number }>()
  private readonly listeners = new Set<(event: AssetEvent) => void>()
  private database?: AssetDatabase
  private cacheGeneration = 0
  private activeDownloadCount = 0
  private activeBackgroundDownloadCount = 0

  constructor(private readonly options: AssetWorkerRuntimeOptions) {
    if (!options.cacheNamespace)
      throw new TypeError('Asset worker cacheNamespace is required.')
    this.workerBuildId = options.workerBuildId ?? 'development'
    this.now = options.now ?? Date.now
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.maxConcurrentDownloads = positiveInteger(options.maxConcurrentDownloads ?? 2, 'maxConcurrentDownloads')
    this.maxConcurrentBackgroundDownloads = positiveInteger(options.maxConcurrentBackgroundDownloads ?? 1, 'maxConcurrentBackgroundDownloads')
    this.writerLeaseMs = positiveInteger(options.writerLeaseMs ?? WRITER_LEASE_MS, 'writerLeaseMs')
    if (this.maxConcurrentBackgroundDownloads > this.maxConcurrentDownloads)
      throw new TypeError('maxConcurrentBackgroundDownloads cannot exceed maxConcurrentDownloads.')
  }

  get cacheNamespace() { return this.options.cacheNamespace }

  async initialize(): Promise<void> {
    this.database = await openAssetDatabase()
    const existing = await this.database.get('settings', this.options.cacheNamespace)
    this.cacheGeneration = existing?.cacheGeneration ?? 0
    if (!existing) {
      await this.database.put('settings', {
        cacheNamespace: this.options.cacheNamespace,
        cacheGeneration: 0,
        policyVersion: 1,
      })
    }
    await this.recoverInterruptedWrites()
    for (const job of await this.listUploadJobsIncludingExpired()) {
      if (job.retainUntil <= this.now())
        await this.deleteUpload(job.jobId)
    }
  }

  getGeneration() { return this.cacheGeneration }
  subscribe(listener: (event: AssetEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getCapabilities(): AssetCapabilities {
    return { mode: 'shared-cache', sharedWorker: true, indexedDB: true, opfs: true, mediaProcessing: false, persistentStorage: false, resumableUpload: false }
  }

  async upsertAsset(asset: AssetRecord, variants: readonly AssetVariantRecord[]): Promise<void> {
    const database = this.requireDatabase()
    const transaction = database.transaction(['assetRecords', 'variantRecords'], 'readwrite')
    const key: [string, string] = [this.options.cacheNamespace, asset.assetId]
    const existing = await transaction.objectStore('assetRecords').get(key)
    if (existing && asset.sourceRevision < existing.sourceRevision) {
      transaction.abort()
      throw new AssetError('ASSET_STALE_REVISION', `Asset ${asset.assetId} revision ${asset.sourceRevision} is older than ${existing.sourceRevision}.`)
    }
    await transaction.objectStore('assetRecords').put({ ...existing, ...asset, cacheNamespace: this.options.cacheNamespace })
    for (const variant of variants) {
      if (variant.assetId !== asset.assetId || variant.sourceRevision !== asset.sourceRevision) {
        transaction.abort()
        throw new AssetError('ASSET_IDENTITY_CONFLICT', `Variant ${variant.variantId} does not match its asset revision.`)
      }
      const variantKey: [string, string, number, string] = [this.options.cacheNamespace, variant.assetId, variant.sourceRevision, variant.variantId]
      const stored = await transaction.objectStore('variantRecords').get(variantKey)
      if (stored?.contentDigest && variant.contentDigest && (stored.contentDigest.algorithm !== variant.contentDigest.algorithm || stored.contentDigest.value !== variant.contentDigest.value)) {
        transaction.abort()
        throw new AssetError('ASSET_IDENTITY_CONFLICT', `Variant ${variant.variantId} has conflicting content digests.`)
      }
      await transaction.objectStore('variantRecords').put({ ...stored, ...variant, cacheNamespace: this.options.cacheNamespace })
    }
    await transaction.done
  }

  async resolve(request: ResolveAssetRequest): Promise<ResolvedAsset> {
    const cacheKey = await createCacheKey(this.options.cacheNamespace, request.ref)
    const database = this.requireDatabase()
    const entry = await database.get('cacheEntries', cacheKey)
    if (entry?.status === 'ready') {
      const variant = await this.getVariant(request.ref)
      const file = await this.files.read(entry.opfsPath, variant?.remoteFileId ?? request.ref.variantId, variant?.contentType)
      if (file && (entry.sizeBytes === undefined || file.size === entry.sizeBytes)) {
        const leaseId = crypto.randomUUID()
        const now = this.now()
        this.leases.set(leaseId, { cacheKey, expiresAt: now + FILE_LEASE_MS })
        if (!entry.leaseProtectionUntil || entry.leaseProtectionUntil < now + 60_000 || now - entry.lastAccessAt >= 60_000) {
          entry.leaseProtectionUntil = now + FILE_LEASE_MS
          if (now - entry.lastAccessAt >= 60_000) {
            entry.lastAccessAt = now
            entry.evictAfter = now + this.expiryFor(variant)
          }
          entry.updatedAt = now
          await database.put('cacheEntries', entry)
        }
        return { source: 'opfs', file, leaseId }
      }
      await database.delete('cacheEntries', cacheKey)
    }
    if (!request.fallbackUrl)
      throw new AssetUnavailableError(`Asset ${request.ref.assetId}/${request.ref.variantId} is unavailable.`)
    if (request.cacheOnMiss !== false)
      void this.ensureCached({ ref: request.ref, url: request.fallbackUrl, priority: request.priority }).catch(() => {})
    return { source: 'url', url: request.fallbackUrl }
  }

  async ensureCached(request: CacheAssetRequest): Promise<AssetJobSnapshot> {
    if (!request.url)
      throw new AssetUnavailableError('A remote URL is required to cache an asset.')
    const cacheKey = await createCacheKey(this.options.cacheNamespace, request.ref)
    const existing = this.inflightByCacheKey.get(cacheKey)
    if (existing) {
      if (!existing.started && request.priority === 'interactive' && existing.priority === 'background') {
        existing.priority = 'interactive'
        existing.request = { ...existing.request, priority: 'interactive' }
        this.drainDownloadQueue()
      }
      return await existing.promise
    }
    const scheduled = this.scheduleDownload(cacheKey, request)
    this.inflightByCacheKey.set(cacheKey, scheduled)
    this.downloadQueue.push(scheduled)
    this.drainDownloadQueue()
    try { return await scheduled.promise }
    finally {
      if (this.inflightByCacheKey.get(cacheKey) === scheduled)
        this.inflightByCacheKey.delete(cacheKey)
    }
  }

  async cacheLocal(asset: AssetRecord, variant: AssetVariantRecord, file: File): Promise<AssetJobSnapshot> {
    const cacheKey = await createCacheKey(this.options.cacheNamespace, variant)
    const existing = this.inflightByCacheKey.get(cacheKey)
    if (existing)
      return await existing.promise

    const scheduled = this.scheduleDownload(cacheKey, { ref: variant, url: '', priority: 'interactive' })
    scheduled.started = true
    this.inflightByCacheKey.set(cacheKey, scheduled)
    void this.upsertAsset(asset, [variant])
      .then(() => this.writeLocalFile(cacheKey, variant, file))
      .then(scheduled.resolve, scheduled.reject)
    try {
      return await scheduled.promise
    }
    finally {
      if (this.inflightByCacheKey.get(cacheKey) === scheduled)
        this.inflightByCacheKey.delete(cacheKey)
    }
  }

  async getCacheStatus(ref: ResolveAssetRequest['ref']): Promise<AssetCacheSnapshot> {
    const entry = await this.requireDatabase().get('cacheEntries', await createCacheKey(this.options.cacheNamespace, ref))
    return entry ? this.toCacheSnapshot(entry) : { ref, status: 'not-cached' }
  }

  async getJobStatus(jobId: string) {
    const job = await this.requireDatabase().get('jobs', [this.options.cacheNamespace, jobId])
    return job && { jobId: job.jobId, kind: job.kind, status: job.status, phase: job.phase, progress: job.progress, errorCode: job.errorCode, updatedAt: job.updatedAt }
  }

  async renew(leaseId: string) {
    const lease = this.leases.get(leaseId)
    if (!lease)
      return
    lease.expiresAt = this.now() + FILE_LEASE_MS
    const entry = await this.requireDatabase().get('cacheEntries', lease.cacheKey)
    if (entry) { entry.leaseProtectionUntil = lease.expiresAt; await this.requireDatabase().put('cacheEntries', entry) }
  }

  release(leaseId: string) { this.leases.delete(leaseId) }

  async evict(ref: ResolveAssetRequest['ref']): Promise<AssetCacheReport> {
    return await this.sweep('explicit', await createCacheKey(this.options.cacheNamespace, ref))
  }

  async sweep(reason: AssetCacheReport['reason'] = 'scheduled', onlyCacheKey?: string): Promise<AssetCacheReport> {
    const database = this.requireDatabase()
    const entries = (await database.getAll('cacheEntries')).filter(entry => entry.cacheNamespace === this.options.cacheNamespace && (!onlyCacheKey || entry.cacheKey === onlyCacheKey))
    const trackedBytes = entries.reduce((sum, entry) => sum + (entry.sizeBytes ?? entry.download?.downloadedBytes ?? 0), 0)
    const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined)
    const knownQuota = Number.isFinite(estimate?.quota) && (estimate?.quota ?? 0) > 0
    const knownUsage = Number.isFinite(estimate?.usage) && (estimate?.usage ?? -1) >= 0
    const budget = this.options.cacheBudgetBytes ?? (knownQuota ? Math.min(5 * 1024 ** 3, estimate!.quota! * 0.4) : 1024 ** 3)
    const highWaterMark = budget * 0.9
    const lowWaterMark = budget * 0.7
    const originPressure = knownQuota && knownUsage && estimate!.usage! / estimate!.quota! >= 0.8
    const forceLru = reason === 'explicit' || reason === 'quota-error' || reason === 'quota-pressure' || trackedBytes > highWaterMark || originPressure
    const now = this.now()
    const leasedKeys = new Set([...this.leases.values()].filter(lease => lease.expiresAt > now).map(lease => lease.cacheKey))
    const candidates = entries.filter(entry => (reason === 'explicit' || (entry.writerLeaseUntil ?? 0) <= now)
      && (entry.status !== 'ready' || (!leasedKeys.has(entry.cacheKey) && (entry.leaseProtectionUntil ?? 0) <= now)))
      .sort((a, b) => Number(a.status === 'ready') - Number(b.status === 'ready') || a.lastAccessAt - b.lastAccessAt)
    let remaining = trackedBytes
    let removedEntries = 0
    let removedBytes = 0
    for (const entry of candidates) {
      if (reason !== 'explicit' && (entry.status === 'ready' || entry.download) && entry.evictAfter > now && (!forceLru || remaining <= lowWaterMark))
        continue
      const variant = await this.getVariant(entry)
      if (entry.status === 'ready' && variant?.remoteRecovery === 'none')
        continue
      const transaction = database.transaction('cacheEntries', 'readwrite')
      const current = await transaction.store.get(entry.cacheKey)
      if (!current || current.writerEpoch !== entry.writerEpoch || current.updatedAt !== entry.updatedAt
        || current.leaseProtectionUntil !== entry.leaseProtectionUntil
        || (reason !== 'explicit' && (current.writerLeaseUntil ?? 0) > this.now())) {
        await transaction.done
        continue
      }
      await transaction.store.delete(entry.cacheKey)
      await transaction.done
      await this.files.remove(entry.opfsPath)
      for (const chunk of entry.download?.chunks ?? [])
        await this.files.remove(chunk.path)
      if (entry.download?.pendingPath)
        await this.files.remove(entry.download.pendingPath)
      removedEntries++
      removedBytes += entry.sizeBytes ?? entry.download?.downloadedBytes ?? 0
      remaining -= entry.sizeBytes ?? entry.download?.downloadedBytes ?? 0
    }
    if (reason === 'explicit') {
      for (const entry of entries.filter(item => !candidates.includes(item))) {
        entry.evictAfter = 0
        await database.put('cacheEntries', entry)
      }
    }
    return { reason, removedEntries, removedBytes, retainedLeaseEntries: entries.length - candidates.length, trackedBytes: Math.max(0, remaining) }
  }

  async clearCache(): Promise<AssetCacheReport> {
    const database = this.requireDatabase()
    this.cacheGeneration++
    await database.put('settings', { cacheNamespace: this.options.cacheNamespace, cacheGeneration: this.cacheGeneration, policyVersion: 1 })
    this.emit({ type: 'cache-clearing' })
    return await this.sweep('explicit')
  }

  async stageUpload(job: UploadJobRecord, file: File): Promise<void> {
    if (job.cacheNamespace !== this.options.cacheNamespace)
      throw new AssetError('CACHE_NAMESPACE_MISMATCH', 'Upload job cache namespace does not match the worker runtime.')
    const database = this.requireDatabase()
    const finalPath = `/video-editor-assets/v1/upload-staging/jobs/${job.jobId}/source.bin`
    const temporaryPath = `/video-editor-assets/v1/upload-staging/jobs/${job.jobId}/source.partial`
    await database.put('uploadJobs', { ...job, sourceStaging: { opfsPath: finalPath, status: 'writing' } })
    try {
      await this.files.write(temporaryPath, finalPath, file.stream() as ReadableStream<BufferSource>, file.size)
      await database.put('uploadJobs', { ...job, sourceStaging: { opfsPath: finalPath, status: 'ready' }, updatedAt: this.now() })
    }
    catch (error) {
      await database.put('uploadJobs', { ...job, businessStatus: 'failed', sourceStaging: undefined, updatedAt: this.now() })
      throw error
    }
  }

  async listUploadJobs() { return (await this.listUploadJobsIncludingExpired()).filter(job => job.retainUntil > this.now()) }
  async getUploadJob(jobId: string) { return await this.requireDatabase().get('uploadJobs', [this.options.cacheNamespace, jobId]) }
  async putUploadJob(job: UploadJobRecord) {
    if (job.cacheNamespace !== this.options.cacheNamespace)
      throw new AssetError('CACHE_NAMESPACE_MISMATCH', 'Upload job cache namespace does not match.')
    await this.requireDatabase().put('uploadJobs', job)
  }

  async getUploadPayload(jobId: string) {
    const job = await this.getUploadJob(jobId)
    if (!job?.sourceStaging || job.sourceStaging.status !== 'ready')
      throw new AssetPersistenceUnavailableError(`Upload job ${jobId} has no readable staged source.`)
    const file = await this.files.read(job.sourceStaging.opfsPath, job.sourceName)
    if (!file || file.size !== job.sourceSizeBytes)
      throw new AssetPersistenceUnavailableError(`Upload job ${jobId} staged source is missing or damaged.`)
    return file
  }

  async listUploadSessions(jobId: string) { return await this.requireDatabase().getAllFromIndex('uploadSessions', 'byJob', [this.options.cacheNamespace, jobId]) }
  async putUploadSession(session: UploadSessionRecord) {
    if (session.cacheNamespace !== this.options.cacheNamespace)
      throw new AssetError('CACHE_NAMESPACE_MISMATCH', 'Upload session cache namespace does not match.')
    await this.requireDatabase().put('uploadSessions', session)
  }

  async deleteUpload(jobId: string) {
    const database = this.requireDatabase()
    const job = await this.getUploadJob(jobId)
    const sessions = await this.listUploadSessions(jobId)
    for (const session of sessions) {
      await this.files.remove(session.payloadOpfsPath)
      await database.delete('uploadSessions', [this.options.cacheNamespace, session.uploadId])
    }
    if (job?.sourceStaging)
      await this.files.remove(job.sourceStaging.opfsPath)
    await database.delete('uploadJobs', [this.options.cacheNamespace, jobId])
  }

  close() {
    const error = new Error('Asset worker runtime is closed.')
    for (const scheduled of this.downloadQueue.splice(0))
      scheduled.reject(error)
    this.database?.close(); this.database = undefined; this.leases.clear()
  }

  private scheduleDownload(cacheKey: string, request: CacheAssetRequest): ScheduledDownload {
    let resolve!: ScheduledDownload['resolve']
    let reject!: ScheduledDownload['reject']
    const promise = new Promise<AssetJobSnapshot>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return {
      cacheKey,
      request,
      priority: request.priority ?? 'interactive',
      started: false,
      promise,
      resolve,
      reject,
    }
  }

  private drainDownloadQueue() {
    while (this.activeDownloadCount < this.maxConcurrentDownloads) {
      const interactiveIndex = this.downloadQueue.findIndex(item => item.priority === 'interactive')
      const nextIndex = interactiveIndex >= 0
        ? interactiveIndex
        : this.activeBackgroundDownloadCount < this.maxConcurrentBackgroundDownloads
          ? this.downloadQueue.findIndex(item => item.priority === 'background')
          : -1
      if (nextIndex < 0)
        return
      const [scheduled] = this.downloadQueue.splice(nextIndex, 1)
      if (!scheduled)
        return
      scheduled.started = true
      this.activeDownloadCount++
      if (scheduled.priority === 'background')
        this.activeBackgroundDownloadCount++
      void this.download(scheduled.cacheKey, scheduled.request)
        .then(scheduled.resolve, scheduled.reject)
        .finally(() => {
          this.activeDownloadCount--
          if (scheduled.priority === 'background')
            this.activeBackgroundDownloadCount--
          this.drainDownloadQueue()
        })
    }
  }

  private async download(cacheKey: string, request: CacheAssetRequest): Promise<AssetJobSnapshot> {
    const database = this.requireDatabase()
    const now = this.now()
    const jobId = crypto.randomUUID()
    const claimResult = await this.acquireWriterClaim(cacheKey, request.ref, 'downloading', 30 * DAY)
    if (claimResult.status === 'ready')
      return { jobId, kind: 'cache', status: 'succeeded', progress: 1, updatedAt: now }
    if (claimResult.status === 'waiting')
      return await this.waitForWriter(cacheKey, request, claimResult.leaseUntil)
    const claim = claimResult.claim
    const entry = claim.entry
    const initialProgress = entry.download ? entry.download.downloadedBytes / entry.download.totalBytes : 0
    await database.put('jobs', { cacheNamespace: this.options.cacheNamespace, jobId, kind: 'cache', dedupeKey: cacheKey, status: 'running', phase: 'downloading', progress: initialProgress, createdAt: now, updatedAt: now })
    const temporaryPath = getCacheObjectPath(cacheKey).replace(/\.bin$/, `-${jobId}.bin`)
    let committed = false
    const lease = this.maintainWriterLease(claim)
    try {
      let size: number | undefined
      const legacy = await this.readLegacyResource(request)
      for (let attempt = 0; attempt < 3; attempt++) {
        entry.status = 'writing'
        entry.updatedAt = this.now()
        if (!await this.updateWriterClaim(claim, { status: entry.status, updatedAt: entry.updatedAt }))
          throw new Error('Asset cache writer lost ownership before staging.')
        try {
          size = legacy
            ? await this.files.writeTemporary(temporaryPath, legacy.file.stream() as ReadableStream<BufferSource>, legacy.file.size)
            : await downloadResumable({
                url: request.url,
                outputPath: temporaryPath,
                chunkDirectory: `/video-editor-assets/v1/temp/downloads/${cacheKey}`,
                chunkSize: positiveInteger(this.options.downloadChunkSizeBytes ?? 8 * 1024 * 1024, 'downloadChunkSizeBytes'),
                checkpoint: entry.download,
                files: this.files,
                fetch: this.fetcher,
                assertOwnership: async () => {
                  if (lease.lostOwnership() || !await this.ownsWriterClaim(claim))
                    throw new Error('Asset cache writer lost ownership during download.')
                },
                save: async (download) => {
                  if (!await this.updateWriterClaim(claim, { download, updatedAt: this.now() }))
                    throw new Error('Asset cache writer lost ownership while saving download progress.')
                  entry.download = download
                  const progress = download ? download.downloadedBytes / download.totalBytes : 0
                  await database.put('jobs', { cacheNamespace: this.options.cacheNamespace, jobId, kind: 'cache', dedupeKey: cacheKey, status: 'running', phase: 'downloading', progress, createdAt: now, updatedAt: this.now() })
                  this.emit({ type: 'cache-updated', cache: this.toCacheSnapshot(entry) })
                  this.emit({ type: 'job-updated', job: { jobId, kind: 'cache', status: 'running', phase: 'downloading', progress, updatedAt: this.now() } })
                },
              })
          if (lease.lostOwnership() || !await this.ownsWriterClaim(claim))
            throw new Error('Asset cache writer lost ownership before commit.')
          break
        }
        catch (error) {
          const quotaError = error instanceof DOMException && error.name === 'QuotaExceededError'
          const transientError = error instanceof TypeError || (error instanceof AssetDownloadHttpError && (error.status >= 500 || error.status === 408 || error.status === 429))
          if (attempt === 2 || (!quotaError && !transientError) || !await this.ownsWriterClaim(claim))
            throw error
          entry.retryCount++
          if (quotaError)
            await this.sweep('quota-error')
          else
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
        }
      }
      if (size === undefined)
        throw new Error('Asset cache write did not complete.')
      const chunks = entry.download?.chunks ?? []
      const readyEntry = await this.finalizeWriterClaim(claim, size, temporaryPath)
      if (!readyEntry)
        throw new Error('Asset cache writer lost ownership while finalizing.')
      Object.assign(entry, readyEntry)
      committed = true
      if (legacy)
        await this.files.remove(legacy.path).catch(() => {})
      for (const chunk of chunks)
        await this.files.remove(chunk.path).catch(() => {})
      const job: AssetJobSnapshot = { jobId, kind: 'cache', status: 'succeeded', progress: 1, updatedAt: entry.updatedAt }
      await database.put('jobs', { cacheNamespace: this.options.cacheNamespace, jobId, kind: 'cache', dedupeKey: cacheKey, status: 'succeeded', progress: 1, createdAt: now, updatedAt: entry.updatedAt, expiresAt: now + 7 * DAY })
      this.emit({ type: 'cache-updated', cache: this.toCacheSnapshot(entry) }); this.emit({ type: 'job-updated', job })
      return job
    }
    catch (error) {
      const failureCode = error instanceof DOMException && error.name === 'QuotaExceededError' ? 'ASSET_CACHE_QUOTA_EXCEEDED' : 'ASSET_CACHE_DOWNLOAD_FAILED'
      const failedEntry = await this.failWriterClaim(claim, failureCode)
      const updatedAt = failedEntry?.updatedAt ?? this.now()
      await database.put('jobs', { cacheNamespace: this.options.cacheNamespace, jobId, kind: 'cache', dedupeKey: cacheKey, status: 'failed', errorCode: failureCode, createdAt: now, updatedAt, expiresAt: now + 7 * DAY })
      if (failedEntry)
        this.emit({ type: 'cache-updated', cache: this.toCacheSnapshot(failedEntry) })
      throw error
    }
    finally {
      await lease.stop()
      if (!committed)
        await this.files.remove(temporaryPath).catch(() => {})
    }
  }

  private async readLegacyResource(request: CacheAssetRequest) {
    if (!this.options.legacyResourceDirectory)
      return undefined
    const variant = await this.getVariant(request.ref)
    if (!variant?.sizeBytes || variant.sizeBytes <= 0)
      return undefined
    const url = new URL(request.url)
    // Old keys discarded every query parameter. Only signing parameters are safe.
    if ([...url.searchParams.keys()].some(key => !['Expires', 'OSSAccessKeyId', 'Signature', 'security-token', 'response-content-disposition'].includes(key)))
      return undefined
    const key = `${url.protocol.slice(0, -1)}/${encodeURIComponent(url.host)}/${url.pathname.split('/').filter(Boolean).map(part => encodeURIComponent(part)).join('/')}`
    const path = `${this.options.legacyResourceDirectory}/${key}`
    const file = await this.files.read(path, variant.remoteFileId ?? variant.variantId, variant.contentType)
    return file?.size === variant.sizeBytes ? { path, file } : undefined
  }

  private async writeLocalFile(cacheKey: string, variant: AssetVariantRecord, file: File): Promise<AssetJobSnapshot> {
    const database = this.requireDatabase()
    const now = this.now()
    const jobId = crypto.randomUUID()
    const previous = await database.get('cacheEntries', cacheKey)
    let replaceReadyEpoch: number | undefined
    if (previous?.status === 'ready') {
      const cached = await this.files.read(previous.opfsPath, variant.remoteFileId ?? variant.variantId, variant.contentType)
      if (cached?.size === file.size)
        return { jobId, kind: 'cache', status: 'succeeded', progress: 1, updatedAt: now }
      replaceReadyEpoch = previous.writerEpoch
    }
    const claimResult = await this.acquireWriterClaim(cacheKey, variant, 'writing', this.expiryFor(variant), replaceReadyEpoch)
    if (claimResult.status === 'ready')
      return { jobId, kind: 'cache', status: 'succeeded', progress: 1, updatedAt: claimResult.entry.updatedAt }
    if (claimResult.status === 'waiting')
      return await this.waitForLocalWriter(cacheKey, variant, file, claimResult.leaseUntil)
    const claim = claimResult.claim
    const entry = claim.entry
    await database.put('jobs', { cacheNamespace: this.options.cacheNamespace, jobId, kind: 'cache', dedupeKey: cacheKey, status: 'running', phase: 'writing', progress: 0, createdAt: now, updatedAt: now })
    const temporaryPath = `/video-editor-assets/v1/temp/${jobId}/${crypto.randomUUID()}.partial`
    const outputPath = getCacheObjectPath(cacheKey).replace(/\.bin$/, `-${jobId}.bin`)
    let committed = false
    const lease = this.maintainWriterLease(claim)
    try {
      let size: number | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          size = await this.files.writeTemporary(temporaryPath, file.stream() as ReadableStream<BufferSource>, file.size)
          if (lease.lostOwnership() || !await this.ownsWriterClaim(claim))
            throw new Error('Local asset cache writer lost ownership before commit.')
          await this.files.commitTemporary(temporaryPath, outputPath)
          break
        }
        catch (error) {
          if (!(error instanceof DOMException && error.name === 'QuotaExceededError') || attempt === 1)
            throw error
          entry.retryCount++
          await this.sweep('quota-error')
        }
      }
      if (size === undefined)
        throw new Error('Local asset cache write did not complete.')
      const download = entry.download
      const readyEntry = await this.finalizeWriterClaim(claim, size, outputPath)
      if (!readyEntry)
        throw new Error('Local asset cache writer lost ownership while finalizing.')
      Object.assign(entry, readyEntry)
      committed = true
      for (const chunk of download?.chunks ?? [])
        await this.files.remove(chunk.path).catch(() => {})
      if (download?.pendingPath)
        await this.files.remove(download.pendingPath).catch(() => {})
      if (previous?.status === 'ready' && previous.opfsPath !== outputPath)
        await this.files.remove(previous.opfsPath).catch(() => {})
      const job: AssetJobSnapshot = { jobId, kind: 'cache', status: 'succeeded', progress: 1, updatedAt: entry.updatedAt }
      await database.put('jobs', { cacheNamespace: this.options.cacheNamespace, jobId, kind: 'cache', dedupeKey: cacheKey, status: 'succeeded', progress: 1, createdAt: now, updatedAt: entry.updatedAt, expiresAt: now + 7 * DAY })
      this.emit({ type: 'cache-updated', cache: this.toCacheSnapshot(entry) }); this.emit({ type: 'job-updated', job })
      return job
    }
    catch (error) {
      const failureCode = error instanceof DOMException && error.name === 'QuotaExceededError' ? 'ASSET_CACHE_QUOTA_EXCEEDED' : 'ASSET_CACHE_WRITE_FAILED'
      const failedEntry = await this.failWriterClaim(claim, failureCode)
      const updatedAt = failedEntry?.updatedAt ?? this.now()
      await database.put('jobs', { cacheNamespace: this.options.cacheNamespace, jobId, kind: 'cache', dedupeKey: cacheKey, status: 'failed', errorCode: failureCode, createdAt: now, updatedAt, expiresAt: now + 7 * DAY })
      if (failedEntry)
        this.emit({ type: 'cache-updated', cache: this.toCacheSnapshot(failedEntry) })
      throw error
    }
    finally {
      await lease.stop()
      await this.files.remove(temporaryPath).catch(() => {})
      if (!committed)
        await this.files.remove(outputPath).catch(() => {})
    }
  }

  private async acquireWriterClaim(
    cacheKey: string,
    ref: Pick<AssetVariantRecord, 'assetId' | 'sourceRevision' | 'variantId'>,
    status: Extract<AssetCacheStatus, 'downloading' | 'writing'>,
    expiryMs: number,
    replaceReadyEpoch?: number,
  ): Promise<WriterClaimResult> {
    const database = this.requireDatabase()
    const tokenHash = await hashToken(crypto.randomUUID())
    const transaction = database.transaction(['cacheEntries', 'settings'], 'readwrite')
    const [previous, setting] = await Promise.all([
      transaction.objectStore('cacheEntries').get(cacheKey),
      transaction.objectStore('settings').get(this.options.cacheNamespace),
    ])
    const now = this.now()
    if (previous?.status === 'ready' && previous.writerEpoch !== replaceReadyEpoch) {
      await transaction.done
      return { status: 'ready', entry: previous }
    }
    if (previous?.writerLeaseUntil && previous.writerLeaseUntil > now) {
      await transaction.done
      return { status: 'waiting', leaseUntil: previous.writerLeaseUntil }
    }
    const entry: AssetCacheEntry = {
      cacheKey,
      cacheNamespace: this.options.cacheNamespace,
      ...ref,
      opfsPath: getCacheObjectPath(cacheKey),
      status,
      writerEpoch: (previous?.writerEpoch ?? 0) + 1,
      writerTokenHash: tokenHash,
      writerLeaseUntil: now + this.writerLeaseMs,
      retryCount: previous?.retryCount ?? 0,
      download: previous?.download,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastAccessAt: now,
      evictAfter: now + expiryMs,
    }
    await transaction.objectStore('cacheEntries').put(entry)
    await transaction.done
    return {
      status: 'acquired',
      claim: { entry, generation: setting?.cacheGeneration ?? 0, tokenHash },
    }
  }

  private async updateWriterClaim(claim: WriterClaim, changes: Partial<Pick<AssetCacheEntry, 'retryCount' | 'status' | 'updatedAt' | 'download'>>): Promise<boolean> {
    const database = this.requireDatabase()
    const transaction = database.transaction(['cacheEntries', 'settings'], 'readwrite')
    const [current, setting] = await Promise.all([
      transaction.objectStore('cacheEntries').get(claim.entry.cacheKey),
      transaction.objectStore('settings').get(this.options.cacheNamespace),
    ])
    if (!writerMatches(current, claim, setting?.cacheGeneration, this.now())) {
      await transaction.done
      return false
    }
    await transaction.objectStore('cacheEntries').put({ ...current, ...changes })
    await transaction.done
    return true
  }

  private async renewWriterClaim(claim: WriterClaim): Promise<boolean> {
    const database = this.requireDatabase()
    const transaction = database.transaction(['cacheEntries', 'settings'], 'readwrite')
    const [current, setting] = await Promise.all([
      transaction.objectStore('cacheEntries').get(claim.entry.cacheKey),
      transaction.objectStore('settings').get(this.options.cacheNamespace),
    ])
    if (!writerMatches(current, claim, setting?.cacheGeneration, this.now(), false)) {
      await transaction.done
      return false
    }
    const now = this.now()
    current.writerLeaseUntil = now + this.writerLeaseMs
    current.updatedAt = now
    await transaction.objectStore('cacheEntries').put(current)
    await transaction.done
    return true
  }

  private async ownsWriterClaim(claim: WriterClaim): Promise<boolean> {
    const transaction = this.requireDatabase().transaction(['cacheEntries', 'settings'], 'readonly')
    const [current, setting] = await Promise.all([
      transaction.objectStore('cacheEntries').get(claim.entry.cacheKey),
      transaction.objectStore('settings').get(this.options.cacheNamespace),
    ])
    await transaction.done
    return writerMatches(current, claim, setting?.cacheGeneration, this.now())
  }

  private async finalizeWriterClaim(claim: WriterClaim, sizeBytes: number, opfsPath = claim.entry.opfsPath): Promise<AssetCacheEntry | undefined> {
    const database = this.requireDatabase()
    const transaction = database.transaction(['cacheEntries', 'settings'], 'readwrite')
    const [current, setting] = await Promise.all([
      transaction.objectStore('cacheEntries').get(claim.entry.cacheKey),
      transaction.objectStore('settings').get(this.options.cacheNamespace),
    ])
    const now = this.now()
    if (!writerMatches(current, claim, setting?.cacheGeneration, now)) {
      await transaction.done
      return undefined
    }
    const readyEntry: AssetCacheEntry = {
      ...current,
      status: 'ready',
      opfsPath,
      download: undefined,
      sizeBytes,
      updatedAt: now,
      writerLeaseUntil: undefined,
      writerTokenHash: undefined,
      failureCode: undefined,
    }
    await transaction.objectStore('cacheEntries').put(readyEntry)
    await transaction.done
    return readyEntry
  }

  private async failWriterClaim(claim: WriterClaim, failureCode: string): Promise<AssetCacheEntry | undefined> {
    const database = this.requireDatabase()
    const transaction = database.transaction(['cacheEntries', 'settings'], 'readwrite')
    const [current, setting] = await Promise.all([
      transaction.objectStore('cacheEntries').get(claim.entry.cacheKey),
      transaction.objectStore('settings').get(this.options.cacheNamespace),
    ])
    if (!writerMatches(current, claim, setting?.cacheGeneration, this.now(), false)) {
      await transaction.done
      return undefined
    }
    const failedEntry: AssetCacheEntry = {
      ...current,
      status: 'failed',
      failureCode,
      updatedAt: this.now(),
      writerLeaseUntil: undefined,
      writerTokenHash: undefined,
    }
    await transaction.objectStore('cacheEntries').put(failedEntry)
    await transaction.done
    return failedEntry
  }

  private maintainWriterLease(claim: WriterClaim) {
    let stopped = false
    let ownershipLost = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let renewal: Promise<void> | undefined
    const intervalMs = Math.max(10, Math.floor(this.writerLeaseMs / 3))
    const schedule = () => {
      timer = setTimeout(() => {
        renewal = this.renewWriterClaim(claim)
          .then((renewed) => { ownershipLost ||= !renewed })
          .catch(() => { ownershipLost = true })
          .finally(() => {
            renewal = undefined
            if (!stopped && !ownershipLost)
              schedule()
          })
      }, intervalMs)
    }
    schedule()
    return {
      lostOwnership: () => ownershipLost,
      stop: async () => {
        stopped = true
        if (timer !== undefined)
          clearTimeout(timer)
        await renewal
      },
    }
  }

  private async recoverInterruptedWrites() {
    const database = this.requireDatabase(); const now = this.now()
    const entries = await database.getAll('cacheEntries')
    for (const entry of entries) {
      if (entry.cacheNamespace === this.options.cacheNamespace && (entry.status === 'downloading' || entry.status === 'writing') && (entry.writerLeaseUntil ?? 0) <= now) {
        entry.status = 'failed'; entry.failureCode = 'ASSET_JOB_INTERRUPTED'; entry.updatedAt = now; entry.writerLeaseUntil = undefined; entry.writerTokenHash = undefined
        await database.put('cacheEntries', entry)
      }
    }
  }

  private async listUploadJobsIncludingExpired() { return (await this.requireDatabase().getAll('uploadJobs')).filter(job => job.cacheNamespace === this.options.cacheNamespace) }
  private async waitForWriter(cacheKey: string, request: CacheAssetRequest, leaseUntil: number): Promise<AssetJobSnapshot> {
    let activeLeaseUntil = leaseUntil
    while (this.now() <= activeLeaseUntil) {
      await new Promise(resolve => setTimeout(resolve, 100))
      const entry = await this.requireDatabase().get('cacheEntries', cacheKey)
      if (entry?.status === 'ready')
        return { jobId: crypto.randomUUID(), kind: 'cache', status: 'succeeded', progress: 1, updatedAt: entry.updatedAt }
      if (!entry?.writerLeaseUntil || entry.writerLeaseUntil <= this.now())
        break
      activeLeaseUntil = entry.writerLeaseUntil
    }
    return await this.download(cacheKey, request)
  }

  private async waitForLocalWriter(cacheKey: string, variant: AssetVariantRecord, file: File, leaseUntil: number): Promise<AssetJobSnapshot> {
    let activeLeaseUntil = leaseUntil
    while (this.now() <= activeLeaseUntil) {
      await new Promise(resolve => setTimeout(resolve, 100))
      const entry = await this.requireDatabase().get('cacheEntries', cacheKey)
      if (entry?.status === 'ready')
        return { jobId: crypto.randomUUID(), kind: 'cache', status: 'succeeded', progress: 1, updatedAt: entry.updatedAt }
      if (!entry?.writerLeaseUntil || entry.writerLeaseUntil <= this.now())
        break
      activeLeaseUntil = entry.writerLeaseUntil
    }
    return await this.writeLocalFile(cacheKey, variant, file)
  }

  private requireDatabase() {
    if (!this.database)
      throw new Error('Asset worker runtime is not initialized.'); return this.database
  }

  private async getVariant(ref: { assetId: string, sourceRevision: number, variantId: string }): Promise<StoredAssetVariantRecord | undefined> { return await this.requireDatabase().get('variantRecords', [this.options.cacheNamespace, ref.assetId, ref.sourceRevision, ref.variantId]) }
  private expiryFor(variant?: AssetVariantRecord) { return variant?.profileId ? 14 * DAY : 30 * DAY }
  private toCacheSnapshot(entry: AssetCacheEntry): AssetCacheSnapshot { return { ref: { assetId: entry.assetId, sourceRevision: entry.sourceRevision, variantId: entry.variantId }, status: entry.status, sizeBytes: entry.sizeBytes, downloadedBytes: entry.download?.downloadedBytes ?? entry.sizeBytes, totalBytes: entry.download?.totalBytes ?? entry.sizeBytes, lastAccessAt: entry.lastAccessAt, evictAfter: entry.evictAfter, failureCode: entry.failureCode } }
  private emit(event: AssetEvent) { for (const listener of this.listeners) listener(event) }
}

async function hashToken(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') }
function writerMatches(current: AssetCacheEntry | undefined, claim: WriterClaim, generation: number | undefined, now: number, requireActiveLease = true): current is AssetCacheEntry {
  return generation === claim.generation
    && current?.writerEpoch === claim.entry.writerEpoch
    && current.writerTokenHash === claim.tokenHash
    && (!requireActiveLease || (current.writerLeaseUntil ?? 0) > now)
}
function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1)
    throw new TypeError(`${name} must be an integer greater than or equal to 1.`)
  return value
}
