/* eslint-disable style/max-statements-per-line */
import type { AssetWorkerResult } from '../protocol/messages'
import type { MediaPlaybackInspection, MediaProcessor } from '../renditions/media-processor'
import type { UploadJobRecord, UploadSessionRecord } from '../storage/database'
import type { AssetCacheReport, AssetCacheSnapshot, AssetCapabilities, AssetEvent, AssetJobSnapshot, AssetOptimizationResult, AssetProfileJobSnapshot, AssetRecord, AssetTask, AssetUrlHandle, AssetVariantRecord, CacheAssetRequest, CancelOptimizationRequest, RecoverableUploadSummary, ResolveAssetRequest, ResolvedAsset, ResumableUploadPort, ResumeUploadRequest, RetryOptimizationProfilesRequest, UploadAssetRequest, UploadCheckpointRequest, UploadedAssetResult, UploadedVariant, UploadPreparation, UploadVariantRequest } from '../types'
import { AssetError, AssetPersistenceUnavailableError, AssetUnavailableError } from '../errors'
import { inspectMediaPlayback } from '../renditions/media-processor'
import { AssetWorkerClient } from './worker-client'

export interface VideoUploadPlan {
  compatibilityProfile?: import('../types').VideoRenditionProfile
  requiredProfiles: readonly import('../types').VideoRenditionProfile[]
  optimizationProfiles: readonly import('../types').VideoRenditionProfile[]
}

export interface AssetServiceOptions<TContext = unknown, TPrepared = unknown> {
  expectedCacheNamespace: string
  createSharedWorker: () => SharedWorker
  uploadPort?: UploadPort<TContext, TPrepared>
  renditionProfiles?: readonly import('../types').VideoRenditionProfile[]
  mediaProcessor?: MediaProcessor
  inspectSourcePlayback?: (source: File) => Promise<MediaPlaybackInspection>
  planVideoUpload?: (inspection: MediaPlaybackInspection, plan: VideoUploadPlan) => VideoUploadPlan
  refreshRemoteVariant?: (request: { ref: ResolveAssetRequest['ref'], previousUrl?: string, signal: AbortSignal }) => Promise<{ url: string, urlExpiresAt?: number } | undefined>
}
export interface UploadPort<TContext = unknown, TPrepared = unknown> {
  readonly adapterId: string
  readonly checkpointVersion: number
  prepare: (request: UploadVariantRequest<TContext>) => Promise<UploadPreparation<TPrepared>>
  uploadDirect: (request: { upload: UploadVariantRequest<TContext>, prepared: TPrepared }) => Promise<UploadedVariant>
  checkResumeAccess?: (request: { accessRef: string, context: TContext, signal: AbortSignal }) => Promise<'allowed' | 'denied'>
  restoreUploadedVariant?: (request: { uploaded: Omit<UploadedVariant, 'url'>, context: TContext, signal: AbortSignal }) => Promise<UploadedVariant>
  resumable?: ResumableUploadPort<TContext, TPrepared>
}
export interface AssetService<TContext = unknown> {
  getCapabilities: () => Promise<AssetCapabilities>
  upsertAsset: (asset: AssetRecord, variants: readonly AssetVariantRecord[]) => Promise<void>
  resolve: (request: ResolveAssetRequest) => Promise<ResolvedAsset>
  resolveUrl: (request: ResolveAssetRequest) => Promise<AssetUrlHandle>
  ensureCached: (request: CacheAssetRequest) => Promise<AssetJobSnapshot>
  getJobStatus: (jobId: string) => Promise<AssetJobSnapshot | undefined>
  upload: (request: UploadAssetRequest<TContext>) => AssetTask<UploadedAssetResult>
  listRecoverableUploads: (context: TContext) => Promise<readonly RecoverableUploadSummary[]>
  resumeUpload: (request: ResumeUploadRequest<TContext>) => AssetTask<UploadedAssetResult>
  retryOptimizationProfiles: (request: RetryOptimizationProfilesRequest<TContext>) => AssetTask<AssetOptimizationResult>
  cancelOptimization: (request: CancelOptimizationRequest<TContext>) => Promise<void>
  acknowledgeUpload: (request: UploadCheckpointRequest<TContext>) => Promise<void>
  discardUpload: (request: UploadCheckpointRequest<TContext>) => Promise<void>
  getCacheStatus: (ref: ResolveAssetRequest['ref']) => Promise<AssetCacheSnapshot>
  subscribe: (listener: (event: AssetEvent) => void) => () => void
  sweep: () => Promise<AssetCacheReport>
  clearCache: () => Promise<AssetCacheReport>
  release: (leaseId: string) => void
  requestPersistentStorage: () => Promise<boolean>
  close: () => void
}

const URL_ONLY_CAPABILITIES: AssetCapabilities = { mode: 'url-only', sharedWorker: false, indexedDB: false, opfs: false, mediaProcessing: false, persistentStorage: false, resumableUpload: false }
const CACHE_OPERATION_TIMEOUT_MS = 30 * 60_000

export function createAssetService<TContext = unknown, TPrepared = unknown>(options: AssetServiceOptions<TContext, TPrepared>): AssetService<TContext> {
  if (!options.expectedCacheNamespace)
    throw new TypeError('expectedCacheNamespace is required.')
  let capabilities = { ...URL_ONLY_CAPABILITIES }
  let client: AssetWorkerClient | undefined
  let initialization: Promise<void> | undefined
  let closed = false
  const objectUrls = new Map<string, { url: string, timer: ReturnType<typeof setInterval> }>()
  const listeners = new Set<(event: AssetEvent) => void>()
  const localJobs = new Map<string, AssetJobSnapshot>()
  const optimizationControllers = new Map<string, AbortController>()
  const backgroundRenditionQueue: Array<{
    run: () => Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
  }> = []
  let backgroundRenditionRunning = false
  let unsubscribeClient: (() => void) | undefined

  function initialize() {
    return initialization ??= (async () => {
      try {
        const worker = options.createSharedWorker()
        client = new AssetWorkerClient(worker, options.expectedCacheNamespace)
        const ack = await client.connect()
        capabilities = { ...ack.capabilities, mediaProcessing: Boolean(options.mediaProcessor), resumableUpload: Boolean(options.uploadPort?.resumable && options.uploadPort.checkResumeAccess && options.uploadPort.restoreUploadedVariant) }
        unsubscribeClient = client.subscribe((event) => { for (const listener of listeners) listener(event) })
      }
      catch (error) {
        console.warn('[assets] SharedWorker initialization failed; using url-only mode.', error)
        client?.close(); client = undefined; capabilities = { ...URL_ONLY_CAPABILITIES, mediaProcessing: Boolean(options.mediaProcessor) }
      }
    })()
  }
  async function ready() {
    if (closed)
      throw new Error('AssetService is closed.'); await initialize(); return client
  }
  async function request<T extends AssetWorkerResult>(operation: Parameters<AssetWorkerClient['request']>[0], timeoutMs?: number): Promise<T> {
    const active = await ready()
    if (!active)
      throw new AssetPersistenceUnavailableError()
    try {
      return await active.request<T>(operation, timeoutMs)
    }
    catch (error) {
      if (!(error instanceof AssetError) || error.code !== 'ASSET_CACHE_GENERATION_CHANGED')
        throw error
      await active.connect()
      return await active.request<T>(operation, timeoutMs)
    }
  }
  async function resolve(input: ResolveAssetRequest): Promise<ResolvedAsset> {
    const active = await ready()
    if (active) {
      try { return await active.request<ResolvedAsset>({ type: 'resolve', request: input }) }
      catch (error) {
        if (input.fallbackUrl)
          return { source: 'url', url: input.fallbackUrl }; if (!options.refreshRemoteVariant)
          throw error
      }
    }
    if (input.fallbackUrl)
      return { source: 'url', url: input.fallbackUrl }
    if (options.refreshRemoteVariant) {
      const refreshed = await options.refreshRemoteVariant({ ref: input.ref, previousUrl: input.fallbackUrl, signal: new AbortController().signal })
      if (refreshed?.url) {
        if (active && input.cacheOnMiss !== false)
          void active.request({ type: 'ensure-cached', request: { ref: input.ref, url: refreshed.url, priority: input.priority } }).catch(() => {})
        return { source: 'url', url: refreshed.url }
      }
    }
    throw new AssetUnavailableError(`Asset ${input.ref.assetId}/${input.ref.variantId} is unavailable.`)
  }

  return {
    async getCapabilities() { await ready(); return { ...capabilities } },
    async upsertAsset(asset, variants) { await request({ type: 'upsert-asset', asset, variants }) },
    resolve,
    async resolveUrl(input) {
      const resolved = await resolve(input)
      if (resolved.source === 'url')
        return { url: resolved.url, source: 'url', release() {} }
      const url = URL.createObjectURL(resolved.file)
      const timer = setInterval(() => { void client?.request({ type: 'renew', leaseId: resolved.leaseId }).catch(() => {}) }, 30_000)
      objectUrls.set(resolved.leaseId, { url, timer })
      let released = false
      return { url, source: 'opfs', release() {
        if (released)
          return; released = true; const item = objectUrls.get(resolved.leaseId); if (item) { clearInterval(item.timer); URL.revokeObjectURL(item.url); objectUrls.delete(resolved.leaseId) }; client?.request({ type: 'release', leaseId: resolved.leaseId }).catch(() => {})
      } }
    },
    ensureCached: input => request<AssetJobSnapshot>({ type: 'ensure-cached', request: input }, CACHE_OPERATION_TIMEOUT_MS),
    async getJobStatus(jobId) { return localJobs.get(jobId) ?? await request<AssetJobSnapshot | undefined>({ type: 'get-job-status', jobId }) },
    upload(input) {
      const jobId = crypto.randomUUID()
      const abortController = new AbortController()
      let mainReady = false
      const taskListeners = new Set<(snapshot: AssetJobSnapshot) => void>()
      const notify = (snapshot: AssetJobSnapshot) => { localJobs.set(snapshot.jobId, snapshot); for (const listener of taskListeners) listener(snapshot); for (const listener of listeners) listener({ type: 'job-updated', job: snapshot }) }
      const result = Promise.resolve().then(async (): Promise<UploadedAssetResult> => {
        const current = await ready()
        if (input.resumeAcrossReloads && (!current || !capabilities.resumableUpload))
          throw new AssetPersistenceUnavailableError('Resumable upload requires SharedWorker, IndexedDB, OPFS, and a complete resumable upload adapter.')
        if (!options.uploadPort)
          throw new AssetPersistenceUnavailableError('Upload requires a host UploadPort adapter.')
        if (!Number.isInteger(input.policy.maxOptimizationAttemptsPerProfile) || input.policy.maxOptimizationAttemptsPerProfile < 1)
          throw new TypeError('maxOptimizationAttemptsPerProfile must be an integer greater than or equal to 1.')
        const hasVideoProfiles = input.policy.compatibilityProfileId || input.policy.requiredProfileIds?.length || input.policy.optimizationProfileIds?.length
        const shouldInspect = isVideoFile(input.file) && ((options.planVideoUpload && hasVideoProfiles) || (input.policy.compatibilityProfileId && !definitelyNonMp4Video(input.file)))
        const inspection = shouldInspect ? await inspectSourcePlayback(input.file) : undefined
        const needsCompatibility = definitelyNonMp4Video(input.file)
          || Boolean(inspection && !satisfiesPlaybackContract(inspection))
        if (needsCompatibility && !input.policy.compatibilityProfileId)
          throw new AssetPersistenceUnavailableError('This video is not directly playable and no compatibilityProfileId was provided.')
        const basePlan = {
          compatibilityProfile: needsCompatibility ? requireProfile(input.policy.compatibilityProfileId) : undefined,
          requiredProfiles: (input.policy.requiredProfileIds ?? []).map(requireProfile),
          optimizationProfiles: (input.policy.optimizationProfileIds ?? []).map(requireProfile),
        }
        const plan = inspection && options.planVideoUpload ? options.planVideoUpload(inspection, basePlan) : basePlan
        const { compatibilityProfile, requiredProfiles, optimizationProfiles } = plan
        if (input.resumeAcrossReloads && (compatibilityProfile || requiredProfiles.length || optimizationProfiles.length))
          throw new AssetPersistenceUnavailableError('Cross-reload rendition processing is not available in this runtime build.')
        const canProcessMedia = Boolean(options.mediaProcessor)
        if (compatibilityProfile && !canProcessMedia)
          throw new AssetPersistenceUnavailableError('The requested rendition processing requires an injected MediaProcessor worker.')
        const upload: UploadVariantRequest<TContext> = {
          file: input.file,
          fileName: input.file.name,
          resumeAcrossReloads: input.resumeAcrossReloads === true,
          relation: { kind: 'source' },
          metadata: { contentType: input.file.type || 'application/octet-stream', sizeBytes: input.file.size },
          context: input.context,
          signal: abortController.signal,
          onProgress: progress => notify({ jobId, kind: 'upload', status: 'running', phase: 'uploading-source', progress: progress ?? undefined, updatedAt: Date.now() }),
        }
        const plannedProfiles = [...(compatibilityProfile ? [compatibilityProfile] : []), ...requiredProfiles]
          .filter((profile, index, profiles) => profiles.findIndex(item => item.id === profile.id) === index)
          .map(profile => ({ profileId: profile.id, shortSide: profile.maxShortSide }))
        const uploadPlan = { compatibilityProfileId: compatibilityProfile?.id, profiles: plannedProfiles }
        notify({ jobId, kind: 'upload', status: 'running', phase: 'preparing', progress: 0, uploadPlan, updatedAt: Date.now() })
        const source = input.resumeAcrossReloads ? await uploadResumableSource(jobId, input, upload) : await uploadVariant(upload)
        validateUploadedVariant(source)
        let playback = source
        const existingVariants = (source.existingVariants ?? []).filter(isUsableUploadedVariant)
        const availableVariants: UploadedVariant[] = [source, ...existingVariants]
        if (input.policy.cacheSource)
          cacheUploadedFile(source, source, input.file, 'source', input.file)
        if (compatibilityProfile) {
          const existing = existingVariants.find(variant => variant.profileId === compatibilityProfile.id)
          if (existing) {
            playback = existing
          }
          else {
            notify({ jobId, kind: 'upload', status: 'running', phase: 'processing-compatibility', progress: 0, updatedAt: Date.now() })
            const [processed] = await processor().process({ source: input.file, profiles: [compatibilityProfile], signal: abortController.signal, onProgress: progress => notify({ jobId, kind: 'upload', status: 'running', phase: 'processing-compatibility', progress: progress.ratio, updatedAt: Date.now() }) })
            if (!processed)
              throw new Error(`Compatibility profile ${compatibilityProfile.id} produced no output.`)
            playback = await uploadVariant({
              ...upload,
              file: processed.file,
              fileName: processed.file.name,
              relation: { kind: 'variant', sourceRemoteFileId: source.remoteFileId, profileId: compatibilityProfile.id },
              metadata: { contentType: 'video/mp4', sizeBytes: processed.file.size, width: processed.width, height: processed.height },
              onProgress: progress => notify({ jobId, kind: 'upload', status: 'running', phase: 'uploading-compatibility', progress: progress ?? undefined, updatedAt: Date.now() }),
            })
            validateProfileVariant(playback, compatibilityProfile.id)
            availableVariants.push(playback)
            if (input.policy.cacheProducedVariants)
              cacheUploadedFile(source, playback, processed.file, playback.remoteFileId, input.file)
          }
        }
        const missingRequiredProfiles = requiredProfiles.filter(profile => !availableVariants.some(variant => variant.profileId === profile.id))
        const requiredProfileStatuses: AssetProfileJobSnapshot[] = requiredProfiles.map(profile => ({
          profileId: profile.id,
          status: missingRequiredProfiles.includes(profile) ? 'queued' : 'ready',
          attemptCount: 0,
        }))
        const notifyRequired = (phase: 'processing-required' | 'uploading-required', progress: number | undefined) => notify({
          jobId,
          kind: 'upload',
          status: 'running',
          phase,
          progress,
          profileStatuses: requiredProfileStatuses.map(item => ({ ...item })),
          updatedAt: Date.now(),
        })
        if (missingRequiredProfiles.length && !canProcessMedia)
          throw new AssetPersistenceUnavailableError('Required renditions are missing and no MediaProcessor worker is configured.')
        if (missingRequiredProfiles.length) {
          for (const item of requiredProfileStatuses) {
            if (item.status === 'queued')
              item.status = 'processing'
          }
          notifyRequired('processing-required', 0)
          const processedRenditions = await processor().process({
            source: input.file,
            profiles: missingRequiredProfiles,
            signal: abortController.signal,
            onProgress: (progress) => {
              for (const item of requiredProfileStatuses) {
                if (item.status === 'processing')
                  item.progress = progress.ratio
              }
              notifyRequired('processing-required', progress.ratio)
            },
          })
          const processedByProfile = new Map(processedRenditions.map(rendition => [rendition.profileId, rendition]))
          for (const item of requiredProfileStatuses) {
            if (item.status === 'processing')
              item.status = 'queued'
          }
          for (let index = 0; index < missingRequiredProfiles.length; index++) {
            const profile = missingRequiredProfiles[index]!
            const processed = processedByProfile.get(profile.id)
            if (!processed)
              throw new Error(`Required profile ${profile.id} produced no output.`)
            const profileStatus = requiredProfileStatuses.find(item => item.profileId === profile.id)!
            profileStatus.status = 'uploading'
            profileStatus.progress = 0
            notifyRequired('uploading-required', index / missingRequiredProfiles.length)
            const uploaded = await uploadVariant({
              ...upload,
              file: processed.file,
              fileName: processed.file.name,
              relation: { kind: 'variant', sourceRemoteFileId: source.remoteFileId, profileId: profile.id },
              metadata: { contentType: 'video/mp4', sizeBytes: processed.file.size, width: processed.width, height: processed.height },
              onProgress: (progress) => {
                profileStatus.progress = progress ?? undefined
                notifyRequired(
                  'uploading-required',
                  progress === null ? undefined : (index + progress) / missingRequiredProfiles.length,
                )
              },
            })
            validateProfileVariant(uploaded, profile.id)
            profileStatus.status = 'ready'
            profileStatus.progress = 1
            notifyRequired('uploading-required', (index + 1) / missingRequiredProfiles.length)
            availableVariants.push(uploaded)
            if (input.policy.cacheProducedVariants)
              cacheUploadedFile(source, uploaded, processed.file, uploaded.remoteFileId, input.file)
          }
        }
        const missingOptimizationProfiles = optimizationProfiles.filter(profile => !availableVariants.some(variant => variant.profileId === profile.id))
        const optimizationJobId = missingOptimizationProfiles.length ? crypto.randomUUID() : undefined
        const canScheduleOptimization = canProcessMedia && supportsOriginBackgroundScheduling()
        const snapshot: AssetJobSnapshot = {
          jobId,
          kind: 'upload',
          status: 'succeeded',
          phase: 'ready',
          progress: 1,
          profileStatuses: requiredProfileStatuses.map(item => ({ ...item, status: 'ready' })),
          updatedAt: Date.now(),
        }
        notify(snapshot)
        if (optimizationJobId && canScheduleOptimization) {
          const optimizationController = new AbortController()
          optimizationControllers.set(optimizationJobId, optimizationController)
          const queuedSnapshot: AssetJobSnapshot = {
            jobId: optimizationJobId,
            kind: 'derivation',
            status: 'queued',
            profileStatuses: missingOptimizationProfiles.map(profile => ({ profileId: profile.id, status: 'queued', attemptCount: 0 })),
            updatedAt: Date.now(),
          }
          localJobs.set(optimizationJobId, queuedSnapshot)
          for (const listener of listeners)
            listener({ type: 'job-updated', job: queuedSnapshot })
          void enqueueBackgroundRendition(() => runOptimizations(optimizationJobId, source, input.file, upload, missingOptimizationProfiles, input.policy.maxOptimizationAttemptsPerProfile, input.policy.cacheProducedVariants, optimizationController.signal))
            .catch((error) => {
              const failedSnapshot: AssetJobSnapshot = { jobId: optimizationJobId, kind: 'derivation', status: 'failed', errorCode: error instanceof Error ? error.name : 'ASSET_OPTIMIZATION_FAILED', updatedAt: Date.now() }
              localJobs.set(optimizationJobId, failedSnapshot)
              for (const listener of listeners)
                listener({ type: 'job-updated', job: failedSnapshot })
            })
            .finally(() => optimizationControllers.delete(optimizationJobId))
        }
        else if (optimizationJobId) {
          const errorCode = canProcessMedia ? 'ASSET_BACKGROUND_SCHEDULING_UNAVAILABLE' : 'ASSET_MEDIA_PROCESSING_UNAVAILABLE'
          const unavailableSnapshot: AssetJobSnapshot = {
            jobId: optimizationJobId,
            kind: 'derivation',
            status: 'succeeded-with-errors',
            errorCode,
            profileStatuses: missingOptimizationProfiles.map(profile => ({
              profileId: profile.id,
              status: 'failed',
              attemptCount: 0,
              errorCode,
            })),
            updatedAt: Date.now(),
          }
          localJobs.set(optimizationJobId, unavailableSnapshot)
          for (const listener of listeners)
            listener({ type: 'job-updated', job: unavailableSnapshot })
        }
        if (input.resumeAcrossReloads) {
          const checkpoint = await request<UploadJobRecord>({ type: 'get-upload-job', jobId })
          checkpoint.businessStatus = 'awaiting-business-commit'
          checkpoint.result = { status: 'ready', source: persistVariant(source), playback: persistVariant(playback), availableVariants: availableVariants.map(persistVariant), optimizationJobId }
          checkpoint.updatedAt = Date.now()
          await request({ type: 'put-upload-job', job: checkpoint })
        }
        mainReady = true
        return { jobId, status: 'ready', source, playback, availableVariants, optimizationJobId }
      }).catch((error) => {
        if (localJobs.get(jobId)?.status !== 'cancelled') {
          notify({
            jobId,
            kind: 'upload',
            status: abortController.signal.aborted ? 'cancelled' : 'failed',
            errorCode: getUploadFailureCode(error),
            updatedAt: Date.now(),
          })
        }
        throw error
      })
      return { jobId, result, subscribe(listener) { taskListeners.add(listener); return () => taskListeners.delete(listener) }, cancel: async () => {
        if (mainReady)
          return; abortController.abort(); if (input.resumeAcrossReloads)
          await discardPersistentUpload(jobId, input.context).catch(() => {}); notify({ jobId, kind: 'upload', status: 'cancelled', updatedAt: Date.now() })
      } }
    },
    async listRecoverableUploads(context) {
      await requireResumableCapability()
      const jobs = await request<readonly UploadJobRecord[]>({ type: 'list-upload-jobs' })
      const visible: RecoverableUploadSummary[] = []
      for (const job of jobs) {
        if (job.adapterId !== options.uploadPort?.adapterId || job.checkpointVersion !== options.uploadPort.checkpointVersion)
          continue
        if (await options.uploadPort.checkResumeAccess?.({ accessRef: job.accessRef, context, signal: new AbortController().signal }) !== 'allowed')
          continue
        visible.push({ jobId: job.jobId, continuationRef: job.continuationRef, businessStatus: job.businessStatus, updatedAt: job.updatedAt, retainUntil: job.retainUntil })
      }
      return visible
    },
    resumeUpload(input) {
      const abortController = new AbortController()
      return {
        jobId: input.jobId,
        result: resumePersistentUpload(input.jobId, input.context, abortController.signal),
        subscribe: () => () => {},
        cancel: async () => { abortController.abort() },
      }
    },
    retryOptimizationProfiles(input) { return unavailableTask<AssetOptimizationResult>(input.jobId, 'Optimization retry is unavailable because media processing is not configured.') },
    async cancelOptimization(input) {
      const controller = optimizationControllers.get(input.jobId)
      if (!controller)
        throw new AssetPersistenceUnavailableError(`Optimization job ${input.jobId} is not active in this client session.`)
      controller.abort()
    },
    async acknowledgeUpload(input) {
      const job = await requireAccessibleUpload(input.jobId, input.context)
      job.businessStatus = 'committed'; job.updatedAt = Date.now()
      if (job.optimizationStatus === 'not-planned' || job.optimizationStatus === 'succeeded' || job.optimizationStatus === 'cancelled')
        await request({ type: 'delete-upload', jobId: job.jobId })
      else
        await request({ type: 'put-upload-job', job })
    },
    async discardUpload(input) { await discardPersistentUpload(input.jobId, input.context) },
    getCacheStatus: ref => request<AssetCacheSnapshot>({ type: 'get-cache-status', ref }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    sweep: () => request<AssetCacheReport>({ type: 'sweep' }),
    clearCache: () => request<AssetCacheReport>({ type: 'clear-cache' }),
    release(leaseId) { const item = objectUrls.get(leaseId); if (item) { clearInterval(item.timer); URL.revokeObjectURL(item.url); objectUrls.delete(leaseId) }; void client?.request({ type: 'release', leaseId }).catch(() => {}) },
    async requestPersistentStorage() {
      await ready(); if (!navigator.storage?.persist)
        return false; capabilities.persistentStorage = await navigator.storage.persist(); return capabilities.persistentStorage
    },
    close() {
      if (closed)
        return; closed = true; unsubscribeClient?.(); for (const controller of optimizationControllers.values()) controller.abort(); optimizationControllers.clear(); for (const [leaseId, item] of objectUrls) { clearInterval(item.timer); URL.revokeObjectURL(item.url); void client?.request({ type: 'release', leaseId }).catch(() => {}) }; objectUrls.clear(); client?.close(); listeners.clear()
    },
  }

  async function requireResumableCapability() {
    await ready()
    if (!capabilities.resumableUpload)
      throw new AssetPersistenceUnavailableError('Resumable upload requires SharedWorker, IndexedDB, OPFS, and a complete resumable upload adapter.')
  }
  async function requireAccessibleUpload(jobId: string, context: TContext) {
    await requireResumableCapability()
    const job = await request<UploadJobRecord>({ type: 'get-upload-job', jobId })
    if (!job)
      throw new AssetPersistenceUnavailableError(`Upload checkpoint ${jobId} does not exist.`)
    if (job.adapterId !== options.uploadPort?.adapterId || job.checkpointVersion !== options.uploadPort.checkpointVersion)
      throw new AssetPersistenceUnavailableError(`Upload checkpoint ${jobId} uses an incompatible adapter.`)
    const access = await options.uploadPort.checkResumeAccess?.({ accessRef: job.accessRef, context, signal: new AbortController().signal })
    if (access !== 'allowed')
      throw new AssetError('UPLOAD_ACCESS_DENIED', `Access to upload checkpoint ${jobId} was denied.`)
    return job
  }

  function requireProfile(profileId: string | undefined) {
    const profile = options.renditionProfiles?.find(candidate => candidate.id === profileId)
    if (!profile)
      throw new TypeError(`Unknown rendition profile: ${profileId ?? '(missing)'}.`)
    return profile
  }
  function processor() {
    if (!options.mediaProcessor)
      throw new AssetPersistenceUnavailableError('Rendition processing requires an injected MediaProcessor, such as createWorkerMediaProcessor().')
    return options.mediaProcessor
  }
  async function inspectSourcePlayback(source: File) {
    return await (options.inspectSourcePlayback ?? inspectMediaPlayback)(source)
  }
  function enqueueBackgroundRendition(run: () => Promise<void>) {
    const result = new Promise<void>((resolve, reject) => {
      backgroundRenditionQueue.push({ run, resolve, reject })
    })
    drainBackgroundRenditions()
    return result
  }
  function drainBackgroundRenditions() {
    if (backgroundRenditionRunning)
      return
    const next = backgroundRenditionQueue.shift()
    if (!next)
      return
    backgroundRenditionRunning = true
    void runWithOriginRenditionLock(next.run)
      .then(next.resolve, next.reject)
      .finally(() => {
        backgroundRenditionRunning = false
        drainBackgroundRenditions()
      })
  }
  async function runWithOriginRenditionLock(run: () => Promise<void>) {
    const lockManager = globalThis.navigator?.locks
    if (!lockManager)
      return await run()
    await lockManager.request(`video-editor-assets:${options.expectedCacheNamespace}:background-rendition`, { mode: 'exclusive' }, run)
  }
  function cacheUploadedFile(source: UploadedVariant, uploaded: UploadedVariant, file: File, variantId: string, sourceFile: File) {
    const now = Date.now()
    const asset: AssetRecord = {
      assetId: source.remoteFileId,
      sourceRevision: 1,
      kind: assetKind(sourceFile.type),
      name: sourceFile.name,
      createdAt: now,
      updatedAt: now,
    }
    const variant: AssetVariantRecord = {
      assetId: source.remoteFileId,
      sourceRevision: 1,
      variantId,
      profileId: uploaded.profileId,
      remoteFileId: uploaded.remoteFileId,
      remoteRecovery: 'host-refreshable',
      contentType: uploaded.contentType || file.type || 'application/octet-stream',
      sizeBytes: file.size,
      width: uploaded.width,
      height: uploaded.height,
      durationMs: uploaded.durationMs,
      contentDigest: uploaded.contentDigest,
      createdAt: now,
      updatedAt: now,
    }
    void request({ type: 'cache-local', asset, variant, file }, CACHE_OPERATION_TIMEOUT_MS).catch(() => {})
  }
  async function uploadVariant(upload: UploadVariantRequest<TContext>) {
    if (!options.uploadPort)
      throw new AssetPersistenceUnavailableError('Upload requires a host UploadPort adapter.')
    const preparation = await options.uploadPort.prepare(upload)
    if (upload.resumeAcrossReloads && preparation.kind === 'direct')
      throw new AssetPersistenceUnavailableError('The upload adapter returned direct upload for a resumable request.')
    if (preparation.kind === 'resumable')
      throw new AssetPersistenceUnavailableError('Resumable upload checkpoints are not available in this runtime build.')
    return preparation.kind === 'already-uploaded' ? preparation.uploaded : await options.uploadPort.uploadDirect({ upload, prepared: preparation.prepared })
  }
  async function uploadResumableSource(jobId: string, input: UploadAssetRequest<TContext>, upload: UploadVariantRequest<TContext>) {
    const port = options.uploadPort
    if (!port?.resumable || !port.checkResumeAccess || !port.restoreUploadedVariant || !input.continuationRef)
      throw new AssetPersistenceUnavailableError('A resumable upload requires continuationRef and a complete resumable UploadPort.')
    const preparation = await port.prepare(upload)
    if (preparation.kind === 'direct')
      throw new AssetPersistenceUnavailableError('The upload adapter returned direct upload for a resumable request.')
    const accessRef = preparation.accessRef
    if (!accessRef)
      throw new AssetPersistenceUnavailableError('The upload adapter did not provide accessRef for a resumable request.')
    const now = Date.now()
    const job: UploadJobRecord = {
      cacheNamespace: options.expectedCacheNamespace,
      jobId,
      adapterId: port.adapterId,
      checkpointVersion: port.checkpointVersion,
      accessRef,
      continuationRef: input.continuationRef,
      ownerEpoch: 1,
      policy: input.policy,
      businessStatus: 'staging-source',
      optimizationStatus: input.policy.optimizationProfileIds?.length ? 'queued' : 'not-planned',
      sourceName: input.file.name,
      sourceSizeBytes: input.file.size,
      sourceDigest: preparation.kind === 'resumable' ? preparation.contentDigest : preparation.uploaded.contentDigest,
      createdAt: now,
      updatedAt: now,
      retainUntil: now + 7 * 86_400_000,
    }
    await request({ type: 'stage-upload', job, file: input.file }, 120_000)
    if (preparation.kind === 'already-uploaded') {
      job.source = persistVariant(preparation.uploaded); job.businessStatus = 'preparing'; job.updatedAt = Date.now()
      await request({ type: 'put-upload-job', job })
      return preparation.uploaded
    }
    const uploadId = crypto.randomUUID()
    const staged = await request<UploadJobRecord>({ type: 'get-upload-job', jobId })
    const session: UploadSessionRecord = {
      cacheNamespace: options.expectedCacheNamespace,
      uploadId,
      jobId,
      adapterId: port.adapterId,
      checkpointVersion: port.checkpointVersion,
      relation: { kind: 'source' },
      payloadOpfsPath: staged.sourceStaging!.opfsPath,
      payloadName: input.file.name,
      payloadSizeBytes: input.file.size,
      metadata: upload.metadata,
      completedParts: [],
      status: 'preparing',
      createdAt: now,
      updatedAt: now,
      retainUntil: job.retainUntil,
    }
    await request({ type: 'put-upload-session', session })
    const remote = await port.resumable.createSession({ uploadId, upload, prepared: preparation.prepared })
    if (!Number.isInteger(remote.partSizeBytes) || remote.partSizeBytes <= 0)
      throw new TypeError('Resumable upload partSizeBytes must be a positive integer.')
    session.resumeToken = remote.resumeToken; session.partSizeBytes = remote.partSizeBytes; session.status = 'uploading'; session.updatedAt = Date.now()
    await request({ type: 'put-upload-session', session })
    const inspected = await port.resumable.inspectSession({ resumeToken: remote.resumeToken, context: input.context, signal: upload.signal })
    if (inspected.status === 'completed')
      return inspected.uploaded
    if (!('completedParts' in inspected))
      throw new AssetPersistenceUnavailableError(`The remote upload session is ${inspected.status}.`)
    const completed = new Map(inspected.completedParts.map(part => [part.partNumber, part]))
    for (let offset = 0, partNumber = 1; offset < input.file.size; offset += remote.partSizeBytes, partNumber++) {
      if (completed.has(partNumber))
        continue
      const receipt = await port.resumable.uploadPart({ resumeToken: remote.resumeToken, partNumber, offset, bytes: input.file.slice(offset, offset + remote.partSizeBytes), context: input.context, signal: upload.signal })
      completed.set(partNumber, receipt)
      session.completedParts = [...completed.values()].sort((a, b) => a.partNumber - b.partNumber); session.updatedAt = Date.now()
      await request({ type: 'put-upload-session', session })
      upload.onProgress(Math.min(1, (offset + receipt.sizeBytes) / input.file.size))
    }
    session.status = 'completing'; await request({ type: 'put-upload-session', session })
    const uploaded = await port.resumable.completeSession({ resumeToken: remote.resumeToken, completedParts: session.completedParts, descriptor: { fileName: upload.fileName, relation: upload.relation, metadata: upload.metadata, contentDigest: job.sourceDigest }, context: input.context, signal: upload.signal })
    session.status = 'completed'; session.updatedAt = Date.now(); await request({ type: 'put-upload-session', session })
    job.source = persistVariant(uploaded); job.businessStatus = 'preparing'; job.updatedAt = Date.now(); await request({ type: 'put-upload-job', job })
    return uploaded
  }
  async function discardPersistentUpload(jobId: string, context: TContext) {
    await requireAccessibleUpload(jobId, context)
    const sessions = await request<readonly UploadSessionRecord[]>({ type: 'list-upload-sessions', jobId })
    await Promise.allSettled(sessions.filter(session => session.resumeToken).map(session => options.uploadPort!.resumable!.abortSession({ resumeToken: session.resumeToken!, context, signal: new AbortController().signal })))
    await request({ type: 'delete-upload', jobId })
  }
  async function resumePersistentUpload(jobId: string, context: TContext, signal: AbortSignal): Promise<UploadedAssetResult> {
    const job = await requireAccessibleUpload(jobId, context)
    const port = options.uploadPort!
    if (job.result) {
      const restored = await Promise.all(job.result.availableVariants.map(variant => restoreVariant(variant, context, signal)))
      const source = await restoreVariant(job.result.source, context, signal)
      const playback = await restoreVariant(job.result.playback, context, signal)
      return { jobId, status: 'ready', source, playback, availableVariants: restored, optimizationJobId: job.result.optimizationJobId }
    }
    if (job.policy.compatibilityProfileId || job.policy.requiredProfileIds?.length || job.policy.optimizationProfileIds?.length)
      throw new AssetPersistenceUnavailableError('This interrupted upload requires rendition recovery, which is not available in this runtime build.')
    const file = await request<File>({ type: 'get-upload-payload', jobId }, 120_000)
    const upload: UploadVariantRequest<TContext> = {
      file,
      fileName: job.sourceName,
      resumeAcrossReloads: true,
      knownContentDigest: job.sourceDigest,
      relation: { kind: 'source' },
      metadata: { contentType: file.type || 'application/octet-stream', sizeBytes: file.size },
      context,
      signal,
      onProgress() {},
    }
    let uploaded: UploadedVariant
    if (job.source) {
      uploaded = await restoreVariant(job.source, context, signal)
    }
    else {
      const sessions = await request<readonly UploadSessionRecord[]>({ type: 'list-upload-sessions', jobId })
      const session = sessions.filter(candidate => candidate.relation.kind === 'source' && candidate.status !== 'expired').sort((a, b) => b.createdAt - a.createdAt)[0]
      if (!session?.resumeToken || !session.partSizeBytes)
        throw new AssetPersistenceUnavailableError(`Upload checkpoint ${jobId} has no resumable remote session.`)
      const inspected = await port.resumable!.inspectSession({ resumeToken: session.resumeToken, context, signal })
      if (inspected.status === 'completed') {
        uploaded = inspected.uploaded
      }
      else {
        if (!('completedParts' in inspected))
          throw new AssetPersistenceUnavailableError(`The remote upload session is ${inspected.status}.`)
        const completed = new Map(inspected.completedParts.map(part => [part.partNumber, part]))
        for (let offset = 0, partNumber = 1; offset < file.size; offset += session.partSizeBytes, partNumber++) {
          if (completed.has(partNumber))
            continue
          const receipt = await port.resumable!.uploadPart({ resumeToken: session.resumeToken, partNumber, offset, bytes: file.slice(offset, offset + session.partSizeBytes), context, signal })
          completed.set(partNumber, receipt)
          session.completedParts = [...completed.values()].sort((a, b) => a.partNumber - b.partNumber); session.updatedAt = Date.now()
          await request({ type: 'put-upload-session', session })
        }
        uploaded = await port.resumable!.completeSession({ resumeToken: session.resumeToken, completedParts: session.completedParts, descriptor: { fileName: upload.fileName, relation: upload.relation, metadata: upload.metadata, contentDigest: job.sourceDigest }, context, signal })
      }
    }
    validateUploadedVariant(uploaded)
    job.source = persistVariant(uploaded)
    job.businessStatus = 'awaiting-business-commit'
    job.result = { status: 'ready', source: persistVariant(uploaded), playback: persistVariant(uploaded), availableVariants: [persistVariant(uploaded)] }
    job.updatedAt = Date.now()
    await request({ type: 'put-upload-job', job })
    return { jobId, status: 'ready', source: uploaded, playback: uploaded, availableVariants: [uploaded] }
  }
  async function restoreVariant(persisted: Omit<UploadedVariant, 'url' | 'existingVariants'>, context: TContext, signal: AbortSignal) {
    const restored = await options.uploadPort!.restoreUploadedVariant!({ uploaded: persisted, context, signal })
    if (restored.remoteFileId !== persisted.remoteFileId || restored.profileId !== persisted.profileId
      || (persisted.contentDigest && (restored.contentDigest?.algorithm !== persisted.contentDigest.algorithm || restored.contentDigest.value !== persisted.contentDigest.value))) {
      throw new AssetError('ASSET_IDENTITY_CONFLICT', `Restored upload variant ${persisted.remoteFileId} does not match its checkpoint.`)
    }
    validateUploadedVariant(restored)
    return restored
  }
  async function runOptimizations(optimizationJobId: string, source: UploadedVariant, file: File, baseUpload: UploadVariantRequest<TContext>, profiles: readonly import('../types').VideoRenditionProfile[], maxAttempts: number, cacheProducedVariants: boolean, signal: AbortSignal) {
    const statuses: AssetProfileJobSnapshot[] = profiles.map(profile => ({ profileId: profile.id, status: 'queued', attemptCount: 0 }))
    const update = (status: AssetJobSnapshot['status']) => {
      const snapshot: AssetJobSnapshot = { jobId: optimizationJobId, kind: 'derivation', status, profileStatuses: statuses.map(item => ({ ...item })), updatedAt: Date.now() }
      localJobs.set(optimizationJobId, snapshot)
      for (const listener of listeners) listener({ type: 'job-updated', job: snapshot })
    }
    update('queued')
    const remaining = new Set(profiles.map(profile => profile.id))
    for (let attempt = 1; attempt <= maxAttempts && remaining.size; attempt++) {
      const attemptProfiles = profiles.filter(profile => remaining.has(profile.id))
      if (signal.aborted) {
        for (const item of statuses.filter(item => remaining.has(item.profileId)))
          item.status = 'cancelled'
        break
      }
      for (const item of statuses.filter(item => remaining.has(item.profileId))) {
        item.attemptCount = attempt
        item.status = 'processing'
        item.errorCode = undefined
      }
      update('running')
      let processedByProfile: Map<string, import('../renditions/media-processor').ProcessedRendition>
      try {
        const processed = await processor().process({ source: file, profiles: attemptProfiles, signal })
        processedByProfile = new Map(processed.map(rendition => [rendition.profileId, rendition]))
      }
      catch (error) {
        for (const item of statuses.filter(item => remaining.has(item.profileId))) {
          item.status = signal.aborted ? 'cancelled' : 'failed'
          item.errorCode = signal.aborted ? undefined : error instanceof Error ? error.name : 'ASSET_OPTIMIZATION_FAILED'
        }
        if (signal.aborted)
          break
        continue
      }
      for (const profile of attemptProfiles) {
        const item = statuses.find(candidate => candidate.profileId === profile.id)!
        if (signal.aborted) {
          item.status = 'cancelled'
          continue
        }
        try {
          const processed = processedByProfile.get(profile.id)
          if (!processed)
            throw new Error(`Optimization profile ${profile.id} produced no output.`)
          item.status = 'uploading'; update('running')
          const uploaded = await uploadVariant({
            ...baseUpload,
            file: processed.file,
            fileName: processed.file.name,
            relation: { kind: 'variant', sourceRemoteFileId: source.remoteFileId, profileId: profile.id },
            metadata: { contentType: 'video/mp4', sizeBytes: processed.file.size, width: processed.width, height: processed.height },
            onProgress: () => {},
          })
          validateProfileVariant(uploaded, profile.id)
          if (cacheProducedVariants)
            cacheUploadedFile(source, uploaded, processed.file, uploaded.remoteFileId, file)
          item.status = 'ready'
          remaining.delete(profile.id)
        }
        catch (error) {
          item.status = 'failed'
          item.errorCode = error instanceof Error ? error.name : 'ASSET_OPTIMIZATION_FAILED'
        }
      }
    }
    update(signal.aborted || statuses.some(item => item.status === 'cancelled') ? 'cancelled' : statuses.some(item => item.status === 'failed') ? 'succeeded-with-errors' : 'succeeded')
  }
}

function validateUploadedVariant(uploaded: UploadedVariant) {
  if (!uploaded.remoteFileId || !uploaded.url)
    throw new TypeError('UploadPort must return a remoteFileId and URL.')
}

function getUploadFailureCode(error: unknown) {
  if (error instanceof AssetError)
    return error.code
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'ASSET_UPLOAD_CANCELLED'
  return 'ASSET_UPLOAD_FAILED'
}

function isUsableUploadedVariant(uploaded: UploadedVariant) {
  return Boolean(uploaded.remoteFileId && uploaded.url)
}

function validateProfileVariant(uploaded: UploadedVariant, expectedProfileId: string) {
  validateUploadedVariant(uploaded)
  if (uploaded.profileId !== expectedProfileId)
    throw new TypeError(`UploadPort must return profileId ${expectedProfileId} for this rendition.`)
}

function persistVariant(uploaded: UploadedVariant): Omit<UploadedVariant, 'url' | 'existingVariants'> {
  const { url: _url, existingVariants: _existingVariants, ...persisted } = uploaded
  return persisted
}

function unavailableTask<TResult>(jobId: string, message: string): AssetTask<TResult> {
  return { jobId, result: Promise.reject(new AssetPersistenceUnavailableError(message)), subscribe: () => () => {}, cancel: async () => {} }
}

function supportsOriginBackgroundScheduling() {
  return typeof globalThis.navigator?.locks?.request === 'function'
}

function assetKind(contentType: string): AssetRecord['kind'] {
  if (contentType.startsWith('video/'))
    return 'video'
  if (contentType.startsWith('audio/'))
    return 'audio'
  if (contentType.startsWith('image/'))
    return 'image'
  return 'other'
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(?:mp4|mov|webm|mkv|avi|flv|m4v)$/i.test(file.name)
}

function definitelyNonMp4Video(file: File) {
  if (!isVideoFile(file))
    return false
  if (file.type)
    return file.type !== 'video/mp4'
  return !/\.mp4$/i.test(file.name)
}

function satisfiesPlaybackContract(inspection: MediaPlaybackInspection) {
  return inspection.containerMimeType === 'video/mp4'
    && inspection.hasVideo
    && inspection.videoCodec === 'avc'
    && (!inspection.hasAudio || inspection.audioCodec === 'aac')
}
