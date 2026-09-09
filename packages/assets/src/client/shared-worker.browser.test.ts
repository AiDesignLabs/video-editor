import TestAssetWorker from '../worker/test-shared-worker?sharedworker&inline'
import { createAssetService } from './service'

describe('assetService SharedWorker connection', () => {
  it('handshakes with a host-provided worker and exposes shared-cache mode', async () => {
    const service = createAssetService({
      expectedCacheNamespace: 'browser-shared-test',
      createSharedWorker: () => new TestAssetWorker({ name: 'asset-runtime-browser-test' }),
    })
    await expect(service.getCapabilities()).resolves.toMatchObject({ mode: 'shared-cache', sharedWorker: true, indexedDB: true, opfs: true })
    const now = Date.now()
    await expect(service.upsertAsset(
      { assetId: 'shared-asset', sourceRevision: 1, kind: 'image', createdAt: now, updatedAt: now },
      [{ assetId: 'shared-asset', sourceRevision: 1, variantId: 'source', remoteRecovery: 'host-refreshable', createdAt: now, updatedAt: now }],
    )).resolves.toBeUndefined()
    service.close()
  })

  it('uploads a required compatibility rendition before returning playback', async () => {
    const process = vi.fn(async () => [{ profileId: 'editing-v1', file: new File(['compatible'], 'clip.editing-v1.mp4', { type: 'video/mp4' }), width: 640, height: 360 }])
    const relations: unknown[] = []
    const service = createAssetService({
      expectedCacheNamespace: 'browser-shared-test',
      createSharedWorker: () => new TestAssetWorker({ name: 'asset-runtime-browser-test' }),
      renditionProfiles: [{ id: 'editing-v1', container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', maxShortSide: 720, videoBitrate: 2_000_000, audioBitrate: 128_000, keyFrameIntervalMs: 1000 }],
      mediaProcessor: { process },
      uploadPort: {
        adapterId: 'browser-test',
        checkpointVersion: 1,
        prepare: async () => ({ kind: 'direct', prepared: {} }),
        uploadDirect: async ({ upload }) => {
          relations.push(upload.relation)
          return upload.relation.kind === 'source'
            ? { remoteFileId: 'source-file', url: 'https://example.com/source.mov' }
            : { remoteFileId: 'playback-file', profileId: upload.relation.profileId, url: 'https://example.com/playback.mp4' }
        },
      },
    })
    const task = service.upload({
      file: new File(['source'], 'clip.mov', { type: 'video/quicktime' }),
      context: {},
      policy: { compatibilityProfileId: 'editing-v1', maxOptimizationAttemptsPerProfile: 2, cacheSource: true, cacheProducedVariants: true },
    })
    await expect(task.result).resolves.toMatchObject({ source: { remoteFileId: 'source-file' }, playback: { remoteFileId: 'playback-file', profileId: 'editing-v1' } })
    expect(relations).toEqual([{ kind: 'source' }, { kind: 'variant', sourceRemoteFileId: 'source-file', profileId: 'editing-v1' }])
    expect(process).toHaveBeenCalledOnce()
    const sourceRef = { assetId: 'source-file', sourceRevision: 1, variantId: 'source' }
    const playbackRef = { assetId: 'source-file', sourceRevision: 1, variantId: 'playback-file' }
    await vi.waitFor(async () => {
      await expect(service.getCacheStatus(sourceRef)).resolves.toMatchObject({ status: 'ready' })
      await expect(service.getCacheStatus(playbackRef)).resolves.toMatchObject({ status: 'ready' })
    })
    const sourceHandle = await service.resolveUrl({ ref: sourceRef })
    expect(sourceHandle.source).toBe('opfs')
    sourceHandle.release()
    service.close()
  })

  it('persists multipart checkpoints and restores an awaiting result after reopening', async () => {
    const uploadedParts: number[] = []
    const uploadPort = {
      adapterId: 'resumable-browser-test',
      checkpointVersion: 1,
      prepare: async () => ({ kind: 'resumable' as const, prepared: {}, accessRef: 'allowed-job' }),
      uploadDirect: async () => { throw new Error('direct upload must not run') },
      checkResumeAccess: async () => 'allowed' as const,
      restoreUploadedVariant: async ({ uploaded }: { uploaded: { remoteFileId: string } }) => ({ ...uploaded, url: `https://example.com/${uploaded.remoteFileId}` }),
      resumable: {
        createSession: async () => ({ resumeToken: 'resume-one', partSizeBytes: 3 }),
        inspectSession: async () => ({ status: 'uploading' as const, completedParts: [] }),
        uploadPart: async ({ partNumber, bytes }: { partNumber: number, bytes: Blob }) => {
          uploadedParts.push(partNumber)
          return { partNumber, sizeBytes: bytes.size, receipt: `part-${partNumber}` }
        },
        completeSession: async () => ({ remoteFileId: 'resumable-source', url: 'https://example.com/source' }),
        abortSession: async () => {},
      },
    }
    const createService = () => createAssetService({ expectedCacheNamespace: 'browser-shared-test', createSharedWorker: () => new TestAssetWorker({ name: 'asset-runtime-browser-test' }), uploadPort })
    const first = createService()
    const task = first.upload({
      file: new File(['1234567'], 'large.mp4', { type: 'video/mp4' }),
      context: {},
      resumeAcrossReloads: true,
      continuationRef: 'node-1',
      policy: { maxOptimizationAttemptsPerProfile: 2, cacheSource: true, cacheProducedVariants: true },
    })
    const result = await task.result
    expect(uploadedParts).toEqual([1, 2, 3])
    await expect(first.listRecoverableUploads({})).resolves.toEqual([expect.objectContaining({ jobId: result.jobId, continuationRef: 'node-1', businessStatus: 'awaiting-business-commit' })])
    first.close()

    const reopened = createService()
    await expect(reopened.resumeUpload({ jobId: result.jobId, context: {} }).result).resolves.toMatchObject({ source: { remoteFileId: 'resumable-source', url: 'https://example.com/resumable-source' } })
    await reopened.acknowledgeUpload({ jobId: result.jobId, context: {} })
    await expect(reopened.listRecoverableUploads({})).resolves.toEqual([])
    reopened.close()
  })
})
