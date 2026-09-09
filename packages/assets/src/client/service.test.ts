/* eslint-disable style/max-statements-per-line */
import type { MediaProcessor } from '../renditions/media-processor'
import type { AssetJobSnapshot } from '../types'
import type { UploadPort } from './service'
import { createAssetService } from './service'

const TEST_PROFILE = {
  id: 'review-720p-v1',
  container: 'mp4',
  videoCodec: 'avc',
  audioCodec: 'aac',
  maxShortSide: 720,
  videoBitrate: 2_500_000,
  audioBitrate: 128_000,
  keyFrameIntervalMs: 1_000,
} as const

const TEST_PROFILE_1080 = {
  ...TEST_PROFILE,
  id: 'review-1080p-v1',
  maxShortSide: 1080,
  videoBitrate: 5_000_000,
} as const

function createUploadPort(): UploadPort<Record<string, never>, Record<string, never>> {
  return {
    adapterId: 'test-adapter',
    checkpointVersion: 1,
    prepare: async () => ({ kind: 'direct' as const, prepared: {} }),
    uploadDirect: vi.fn(async ({ upload }) => upload.relation.kind === 'source'
      ? { remoteFileId: 'source-1', url: 'https://example.com/source-1.mp4' }
      : { remoteFileId: `variant-${upload.relation.profileId}`, url: `https://example.com/${upload.relation.profileId}.mp4`, profileId: upload.relation.profileId }),
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('assetService fallback and direct upload', () => {
  it('executes the host plan once per output and exposes that plan before upload', async () => {
    const profile360 = { ...TEST_PROFILE, id: 'review-360p-v1', maxShortSide: 360 }
    const uploadPort = createUploadPort()
    const snapshots: AssetJobSnapshot[] = []
    const process = vi.fn(async ({ profiles }: Parameters<MediaProcessor['process']>[0]) => profiles.map(profile => ({
      profileId: profile.id,
      file: new File(['mp4'], `${profile.id}.mp4`, { type: 'video/mp4' }),
      width: profile.maxShortSide === 720 ? 1280 : 640,
      height: profile.maxShortSide,
    })))
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('No worker') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE_1080, TEST_PROFILE, profile360],
      mediaProcessor: { process },
      inspectSourcePlayback: async () => ({ containerMimeType: 'video/quicktime', videoCodec: 'avc', audioCodec: 'aac', hasVideo: true, hasAudio: true, width: 1280, height: 720 }),
      planVideoUpload: () => ({ compatibilityProfile: TEST_PROFILE, requiredProfiles: [profile360], optimizationProfiles: [] }),
    })
    const task = service.upload({ file: new File(['mov'], 'source.mov', { type: 'video/quicktime' }), context: {}, policy: { compatibilityProfileId: TEST_PROFILE_1080.id, requiredProfileIds: [TEST_PROFILE_1080.id, TEST_PROFILE.id, profile360.id], cacheSource: false, cacheProducedVariants: false, maxOptimizationAttemptsPerProfile: 1 } })
    task.subscribe(snapshot => snapshots.push(snapshot))
    const result = await task.result
    expect(uploadPort.uploadDirect).toHaveBeenCalledTimes(3)
    expect(result.playback.profileId).toBe(TEST_PROFILE.id)
    expect(result.availableVariants).toHaveLength(3)
    expect(process.mock.calls.flatMap(([request]) => request.profiles.map(profile => profile.id))).toEqual([TEST_PROFILE.id, profile360.id])
    expect(snapshots[0]?.uploadPlan).toEqual({ compatibilityProfileId: TEST_PROFILE.id, profiles: [{ profileId: TEST_PROFILE.id, shortSide: 720 }, { profileId: profile360.id, shortSide: 360 }] })
    service.close()
  })
  beforeEach(() => {
    let lockTail: Promise<unknown> = Promise.resolve()
    const request = vi.fn((name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) => {
      const result = lockTail.then(() => callback({ name, mode: options.mode ?? 'exclusive' } as Lock))
      lockTail = result.then(() => undefined, () => undefined)
      return result
    })
    vi.stubGlobal('navigator', { locks: { request } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enters url-only mode when the worker cannot be created', async () => {
    const service = createAssetService({ expectedCacheNamespace: 'test', createSharedWorker: () => { throw new Error('SharedWorker is unavailable') } })
    await expect(service.getCapabilities()).resolves.toMatchObject({ mode: 'url-only', sharedWorker: false })
    await expect(service.resolve({ ref: { assetId: 'a', sourceRevision: 1, variantId: 'source' }, fallbackUrl: 'https://example.com/a.mp4' }))
      .resolves
      .toEqual({ source: 'url', url: 'https://example.com/a.mp4' })
    service.close()
  })

  it('uses the host direct upload adapter without cache storage', async () => {
    const uploadDirect = vi.fn(async () => ({ remoteFileId: 'remote-1', url: 'https://example.com/remote-1.mp4' }))
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort: { adapterId: 'test-adapter', checkpointVersion: 1, prepare: async () => ({ kind: 'direct', prepared: { ticket: 'one' } }), uploadDirect },
    })
    const task = service.upload({ file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }), context: { user: 'one' }, policy: { maxOptimizationAttemptsPerProfile: 2, cacheSource: true, cacheProducedVariants: true } })
    await expect(task.result).resolves.toMatchObject({ status: 'ready', source: { remoteFileId: 'remote-1' }, playback: { remoteFileId: 'remote-1' } })
    expect(uploadDirect).toHaveBeenCalledOnce()
    service.close()
  })

  it('returns a playable source before optional optimization finishes', async () => {
    let finishOptimization!: () => void
    const optimizationGate = new Promise<void>((resolve) => { finishOptimization = resolve })
    const uploadPort = createUploadPort()
    const uploadDirect = uploadPort.uploadDirect
    uploadPort.uploadDirect = vi.fn(async (request) => {
      request.upload.onProgress(0.5)
      return await uploadDirect(request)
    })
    const process = vi.fn(async ({ profiles }: Parameters<MediaProcessor['process']>[0]) => {
      await optimizationGate
      return profiles.map(profile => ({
        profileId: profile.id,
        file: new File(['optimized'], `${profile.id}.mp4`, { type: 'video/mp4' }),
        width: 1280,
        height: 720,
      }))
    })
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process },
    })
    await expect(service.getCapabilities()).resolves.toMatchObject({
      mode: 'url-only',
      mediaProcessing: true,
    })
    const task = service.upload({
      file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { optimizationProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: true, cacheProducedVariants: true },
    })
    const mainJobSnapshots: AssetJobSnapshot[] = []
    const unsubscribe = task.subscribe(snapshot => mainJobSnapshots.push(snapshot))

    await expect(task.result).resolves.toMatchObject({
      source: { remoteFileId: 'source-1' },
      playback: { remoteFileId: 'source-1' },
      optimizationJobId: expect.any(String),
    })
    expect(uploadPort.uploadDirect).toHaveBeenCalledOnce()

    finishOptimization()
    await vi.waitFor(() => expect(uploadPort.uploadDirect).toHaveBeenCalledTimes(2))
    await expect(service.getJobStatus(task.jobId)).resolves.toMatchObject({
      status: 'succeeded',
      phase: 'ready',
    })
    expect(mainJobSnapshots.at(-1)).toMatchObject({ status: 'succeeded', phase: 'ready' })
    unsubscribe()
    service.close()
  })

  it('runs optional rendition jobs one at a time across uploads', async () => {
    const gates = [deferred(), deferred()]
    let processIndex = 0
    const process = vi.fn(async ({ profiles }: Parameters<MediaProcessor['process']>[0]) => {
      const gate = gates[processIndex++]
      if (!gate)
        throw new Error('Unexpected rendition job.')
      await gate.promise
      return profiles.map(profile => ({
        profileId: profile.id,
        file: new File(['optimized'], `${profile.id}.mp4`, { type: 'video/mp4' }),
        width: 1280,
        height: 720,
      }))
    })
    const uploadPort = createUploadPort()
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process },
    })
    const policy = { optimizationProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false }
    const first = service.upload({ file: new File(['one'], 'one.mp4', { type: 'video/mp4' }), context: {}, policy })
    const second = service.upload({ file: new File(['two'], 'two.mp4', { type: 'video/mp4' }), context: {}, policy })

    await Promise.all([first.result, second.result])
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1))
    gates[0]!.resolve()
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(2))
    gates[1]!.resolve()
    await vi.waitFor(() => expect(uploadPort.uploadDirect).toHaveBeenCalledTimes(4))
    service.close()
  })

  it('runs optional rendition jobs one at a time across service instances', async () => {
    const gates = [deferred(), deferred()]
    let processIndex = 0
    const process = vi.fn(async ({ profiles }: Parameters<MediaProcessor['process']>[0]) => {
      const gate = gates[processIndex++]
      if (!gate)
        throw new Error('Unexpected rendition job.')
      await gate.promise
      return profiles.map(profile => ({
        profileId: profile.id,
        file: new File(['optimized'], `${profile.id}.mp4`, { type: 'video/mp4' }),
        width: 1280,
        height: 720,
      }))
    })
    const createService = () => createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort: createUploadPort(),
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process },
    })
    const firstService = createService()
    const secondService = createService()
    const policy = { optimizationProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false }
    const first = firstService.upload({ file: new File(['one'], 'one.mp4', { type: 'video/mp4' }), context: {}, policy })
    const second = secondService.upload({ file: new File(['two'], 'two.mp4', { type: 'video/mp4' }), context: {}, policy })

    await Promise.all([first.result, second.result])
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1))
    gates[0]!.resolve()
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(2))
    gates[1]!.resolve()
    firstService.close()
    secondService.close()
  })

  it('processes all optional profiles in one media pass and uploads them serially', async () => {
    const uploadPort = createUploadPort()
    const process = vi.fn(async ({ profiles }: Parameters<MediaProcessor['process']>[0]) => profiles.map(profile => ({
      profileId: profile.id,
      file: new File(['optimized'], `${profile.id}.mp4`, { type: 'video/mp4' }),
      width: 1920,
      height: profile.maxShortSide,
    })))
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE, TEST_PROFILE_1080],
      mediaProcessor: { process },
    })
    const task = service.upload({
      file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { optimizationProfileIds: [TEST_PROFILE.id, TEST_PROFILE_1080.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false },
    })

    await expect(task.result).resolves.toMatchObject({ optimizationJobId: expect.any(String) })
    await vi.waitFor(() => expect(uploadPort.uploadDirect).toHaveBeenCalledTimes(3))
    expect(process).toHaveBeenCalledOnce()
    expect(process.mock.calls[0]?.[0].profiles.map(profile => profile.id)).toEqual([TEST_PROFILE.id, TEST_PROFILE_1080.id])
    service.close()
  })

  it('reports a partly completed background optimization as cancelled', async () => {
    const firstVariantStarted = deferred()
    const releaseFirstVariant = deferred()
    const uploadPort = createUploadPort()
    uploadPort.uploadDirect = vi.fn(async ({ upload }) => {
      if (upload.relation.kind === 'source')
        return { remoteFileId: 'source-1', url: 'https://example.com/source-1.mp4' }
      if (upload.relation.profileId === TEST_PROFILE.id) {
        firstVariantStarted.resolve()
        await releaseFirstVariant.promise
      }
      return { remoteFileId: `variant-${upload.relation.profileId}`, url: `https://example.com/${upload.relation.profileId}.mp4`, profileId: upload.relation.profileId }
    })
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE, TEST_PROFILE_1080],
      mediaProcessor: { process: async () => [
        { profileId: TEST_PROFILE.id, file: new File(['720'], '720.mp4', { type: 'video/mp4' }), width: 1280, height: 720 },
        { profileId: TEST_PROFILE_1080.id, file: new File(['1080'], '1080.mp4', { type: 'video/mp4' }), width: 1920, height: 1080 },
      ] },
    })
    const task = service.upload({
      file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { optimizationProfileIds: [TEST_PROFILE.id, TEST_PROFILE_1080.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false },
    })
    const result = await task.result
    await firstVariantStarted.promise

    await service.cancelOptimization({ jobId: result.optimizationJobId!, context: {} })
    releaseFirstVariant.resolve()

    await vi.waitFor(async () => {
      await expect(service.getJobStatus(result.optimizationJobId!)).resolves.toMatchObject({
        status: 'cancelled',
        profileStatuses: [
          expect.objectContaining({ profileId: TEST_PROFILE.id, status: 'ready' }),
          expect.objectContaining({ profileId: TEST_PROFILE_1080.id, status: 'cancelled' }),
        ],
      })
    })
    service.close()
  })

  it('keeps optional optimization from blocking a usable source when media processing is unavailable', async () => {
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort: createUploadPort(),
      renditionProfiles: [TEST_PROFILE],
    })
    const task = service.upload({
      file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { optimizationProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: true, cacheProducedVariants: true },
    })

    await expect(task.result).resolves.toMatchObject({
      source: { remoteFileId: 'source-1' },
      playback: { remoteFileId: 'source-1' },
      optimizationJobId: expect.any(String),
    })
    const result = await task.result
    await expect(service.getJobStatus(result.optimizationJobId!)).resolves.toMatchObject({
      status: 'succeeded-with-errors',
      errorCode: 'ASSET_MEDIA_PROCESSING_UNAVAILABLE',
      profileStatuses: [expect.objectContaining({ status: 'failed', attemptCount: 0 })],
    })
    service.close()
  })

  it('skips optional optimization when origin-wide scheduling is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const process = vi.fn(async () => [])
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort: createUploadPort(),
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process },
    })
    const task = service.upload({
      file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { optimizationProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false },
    })

    const result = await task.result
    expect(result.optimizationJobId).toEqual(expect.any(String))
    await expect(service.getJobStatus(result.optimizationJobId!)).resolves.toMatchObject({
      status: 'succeeded-with-errors',
      errorCode: 'ASSET_BACKGROUND_SCHEDULING_UNAVAILABLE',
      profileStatuses: [expect.objectContaining({ status: 'failed', attemptCount: 0 })],
    })
    expect(process).not.toHaveBeenCalled()
    service.close()
  })

  it('creates compatibility playback for an MP4 source that is not AVC and AAC', async () => {
    const uploadPort = createUploadPort()
    const process = vi.fn(async ({ profiles }: Parameters<MediaProcessor['process']>[0]) => profiles.map(profile => ({
      profileId: profile.id,
      file: new File(['compatible'], `${profile.id}.mp4`, { type: 'video/mp4' }),
      width: 1280,
      height: 720,
    })))
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process },
      inspectSourcePlayback: async () => ({ containerMimeType: 'video/mp4', videoCodec: 'hevc', audioCodec: 'aac', hasVideo: true, hasAudio: true }),
    })
    const task = service.upload({
      file: new File(['video'], 'hevc.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { compatibilityProfileId: TEST_PROFILE.id, maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false },
    })

    await expect(task.result).resolves.toMatchObject({
      source: { remoteFileId: 'source-1' },
      playback: { profileId: TEST_PROFILE.id },
    })
    expect(process).toHaveBeenCalledOnce()
    service.close()
  })

  it('does not resolve a review upload until every required profile is uploaded', async () => {
    let finishProcessing!: () => void
    const processingGate = new Promise<void>((resolve) => { finishProcessing = resolve })
    const uploadPort = createUploadPort()
    const process = vi.fn(async ({ profiles }: Parameters<MediaProcessor['process']>[0]) => {
      await processingGate
      return profiles.map(profile => ({
        profileId: profile.id,
        file: new File(['review'], `${profile.id}.mp4`, { type: 'video/mp4' }),
        width: 1280,
        height: 720,
      }))
    })
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process },
    })
    const task = service.upload({
      file: new File(['video'], 'review.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { requiredProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: true, cacheProducedVariants: true },
    })
    const snapshots: AssetJobSnapshot[] = []
    const unsubscribe = task.subscribe(snapshot => snapshots.push(snapshot))
    let settled = false
    void task.result.then(() => { settled = true }, () => { settled = true })

    await vi.waitFor(() => expect(process).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    expect(uploadPort.uploadDirect).toHaveBeenCalledOnce()

    finishProcessing()
    await expect(task.result).resolves.toMatchObject({
      availableVariants: expect.arrayContaining([
        expect.objectContaining({ profileId: TEST_PROFILE.id }),
      ]),
      optimizationJobId: undefined,
    })
    expect(uploadPort.uploadDirect).toHaveBeenCalledTimes(2)
    expect(snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: 'processing-required',
        profileStatuses: [expect.objectContaining({ profileId: TEST_PROFILE.id, status: 'processing' })],
      }),
      expect.objectContaining({
        phase: 'uploading-required',
        profileStatuses: [expect.objectContaining({ profileId: TEST_PROFILE.id, status: 'uploading' })],
      }),
      expect.objectContaining({
        phase: 'ready',
        profileStatuses: [expect.objectContaining({ profileId: TEST_PROFILE.id, status: 'ready' })],
      }),
    ]))
    unsubscribe()
    service.close()
  })

  it('fails a review upload when a required profile cannot be produced', async () => {
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort: createUploadPort(),
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process: async () => [] },
    })
    const task = service.upload({
      file: new File(['video'], 'review.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { requiredProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: true, cacheProducedVariants: true },
    })

    await expect(task.result).rejects.toThrow(`Required profile ${TEST_PROFILE.id} produced no output.`)
    await expect(service.getJobStatus(task.jobId)).resolves.toMatchObject({
      kind: 'upload',
      status: 'failed',
      errorCode: 'ASSET_UPLOAD_FAILED',
    })
    service.close()
  })

  it('rejects a required profile when the upload adapter returns an invalid variant', async () => {
    const uploadPort = createUploadPort()
    uploadPort.uploadDirect = vi.fn(async ({ upload }) => upload.relation.kind === 'source'
      ? { remoteFileId: 'source-1', url: 'https://example.com/source-1.mp4' }
      : { remoteFileId: '', url: '', profileId: upload.relation.profileId })
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process: async () => [{ profileId: TEST_PROFILE.id, file: new File(['review'], 'review.mp4', { type: 'video/mp4' }), width: 1280, height: 720 }] },
    })
    const task = service.upload({
      file: new File(['video'], 'review.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { requiredProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false },
    })

    await expect(task.result).rejects.toThrow('UploadPort must return a remoteFileId and URL.')
    service.close()
  })

  it('does not let an invalid existing variant satisfy a required profile', async () => {
    const uploadPort = createUploadPort()
    uploadPort.uploadDirect = vi.fn(async ({ upload }) => upload.relation.kind === 'source'
      ? { remoteFileId: 'source-1', url: 'https://example.com/source-1.mp4', existingVariants: [{ remoteFileId: '', url: '', profileId: TEST_PROFILE.id }] }
      : { remoteFileId: `variant-${upload.relation.profileId}`, url: `https://example.com/${upload.relation.profileId}.mp4`, profileId: upload.relation.profileId })
    const process = vi.fn(async () => [{ profileId: TEST_PROFILE.id, file: new File(['review'], 'review.mp4', { type: 'video/mp4' }), width: 1280, height: 720 }])
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE],
      mediaProcessor: { process },
    })
    const task = service.upload({
      file: new File(['video'], 'review.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { requiredProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: false, cacheProducedVariants: false },
    })

    await expect(task.result).resolves.toMatchObject({ availableVariants: expect.arrayContaining([expect.objectContaining({ profileId: TEST_PROFILE.id })]) })
    expect(process).toHaveBeenCalledOnce()
    expect(uploadPort.uploadDirect).toHaveBeenCalledTimes(2)
    service.close()
  })

  it('accepts an existing required profile without local media processing', async () => {
    const uploadPort = createUploadPort()
    uploadPort.uploadDirect = vi.fn(async () => ({
      remoteFileId: 'source-1',
      url: 'https://example.com/source-1.mp4',
      existingVariants: [{
        remoteFileId: 'variant-review-720p-v1',
        profileId: TEST_PROFILE.id,
        url: 'https://example.com/review-720p-v1.mp4',
      }],
    }))
    const service = createAssetService({
      expectedCacheNamespace: 'test',
      createSharedWorker: () => { throw new Error('SharedWorker is unavailable') },
      uploadPort,
      renditionProfiles: [TEST_PROFILE],
    })
    const task = service.upload({
      file: new File(['video'], 'review.mp4', { type: 'video/mp4' }),
      context: {},
      policy: { requiredProfileIds: [TEST_PROFILE.id], maxOptimizationAttemptsPerProfile: 1, cacheSource: true, cacheProducedVariants: true },
    })

    await expect(task.result).resolves.toMatchObject({
      availableVariants: expect.arrayContaining([
        expect.objectContaining({ profileId: TEST_PROFILE.id }),
      ]),
    })
    expect(uploadPort.uploadDirect).toHaveBeenCalledOnce()
    service.close()
  })
})
