import type { IVideoProtocol } from '@video-editor/shared'
import type { AssetLibrary, AssetMeta } from './index'
import { describe, expect, it, vi } from 'vitest'
import { createMediaAssetCatalogFromLibrary } from './catalog'

const source: AssetMeta = {
  id: 'source-1',
  name: 'source.mp4',
  url: 'local-asset://source-1/source.mp4',
  kind: 'video',
  sizeBytes: 1000,
  createdAt: 1,
  revision: 2,
  durationMs: 5000,
  width: 1920,
  height: 1080,
  fps: 23.976,
}

const proxy: AssetMeta = {
  id: 'proxy-1',
  name: 'proxy.mp4',
  url: 'local-asset://proxy-1/proxy.mp4',
  kind: 'video',
  sizeBytes: 200,
  createdAt: 2,
  revision: 1,
  derivation: {
    kind: 'proxy',
    sourceAssetId: source.id,
    sourceRevision: 2,
    profile: 'editing-mp4-v1',
  },
}

function createLibrary(assets: AssetMeta[] = [source, proxy]): AssetLibrary {
  return {
    importAsset: vi.fn(async () => source),
    importProxy: vi.fn(async () => proxy),
    listAssets: vi.fn(async () => assets),
    getAsset: vi.fn(async id => assets.find(asset => asset.id === id)),
    resolveAssetUrl: vi.fn(async (id, options) => {
      if (id !== source.id)
        return undefined
      return options?.preferProxy ? proxy.url : source.url
    }),
    listAssetDerivatives: vi.fn(async id => assets.filter(asset => asset.derivation?.sourceAssetId === id)),
    isAssetDerivativeStale: vi.fn(async () => false),
    relinkAsset: vi.fn(async () => source),
    removeAsset: vi.fn(async () => {}),
    getAssetFile: vi.fn(async () => undefined),
  }
}

describe('media asset catalog', () => {
  it('lists original media without storage or proxy internals', async () => {
    const catalog = createMediaAssetCatalogFromLibrary(createLibrary())

    const assets = await catalog.list()

    expect(assets).toEqual([{
      id: source.id,
      name: source.name,
      kind: source.kind,
      sizeBytes: source.sizeBytes,
      createdAt: source.createdAt,
      durationMs: source.durationMs,
      width: source.width,
      height: source.height,
      fps: source.fps,
      proxyStatus: 'ready',
    }])
    expect(assets[0]).not.toHaveProperty('url')
    expect(assets[0]).not.toHaveProperty('revision')
    expect(assets[0]).not.toHaveProperty('derivation')
  })

  it('creates protocol bindings and purpose-specific resolvers', async () => {
    const library = createLibrary()
    const preview = new File(['preview'], 'preview.mp4', { type: 'video/mp4' })
    library.getAssetFile = vi.fn(async () => preview)
    const catalog = createMediaAssetCatalogFromLibrary(library)

    await expect(catalog.bindForSegment(source.id)).resolves.toMatchObject({
      assetId: source.id,
      url: source.url,
      kind: 'video',
      durationMs: 5000,
      fps: 23.976,
    })
    await expect(catalog.resolveForPreview(source.id)).resolves.toBe(proxy.url)
    await expect(catalog.resolveForPreview(source.id, source.url, { media: 'audio' })).resolves.toBe(proxy.url)
    await expect(catalog.resolveForExport(source.id)).resolves.toBe(proxy.url)
    await expect(catalog.getPreviewBlob(source.id)).resolves.toBe(preview)
    expect(library.getAssetFile).toHaveBeenCalledWith(source.id, {
      preferProxy: true,
      proxyProfile: 'editing-mp4-v1',
    })
  })

  it('generates and registers a preview version without exposing its file', async () => {
    const assets = [source]
    const library = createLibrary(assets)
    const sourceFile = new File(['source'], source.name, { type: 'video/mp4' })
    const previewFile = new File(['preview'], 'source.preview.mp4', { type: 'video/mp4' })
    const cleanup = vi.fn(async () => {})
    const generatePreviewFile = vi.fn(async () => ({ file: previewFile, cleanup }))
    library.getAssetFile = vi.fn(async () => sourceFile)
    library.importProxy = vi.fn(async () => {
      assets.push(proxy)
      return proxy
    })
    const catalog = createMediaAssetCatalogFromLibrary(library, {}, { generatePreviewFile })

    await expect(catalog.generatePreviewVersion(source.id)).resolves.toMatchObject({
      id: source.id,
      proxyStatus: 'ready',
    })

    expect(generatePreviewFile).toHaveBeenCalledWith(sourceFile, source.name, expect.objectContaining({
      height: 1080,
      audioBitrate: 192_000,
      keyFrameIntervalMs: 1000,
    }))
    expect(library.importProxy).toHaveBeenCalledWith(source.id, previewFile, 'editing-mp4-v1')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('returns an existing current preview without generating another one', async () => {
    const generatePreviewFile = vi.fn()
    const catalog = createMediaAssetCatalogFromLibrary(createLibrary(), {}, { generatePreviewFile })

    await expect(catalog.generatePreviewVersion(source.id)).resolves.toMatchObject({
      proxyStatus: 'ready',
    })
    expect(generatePreviewFile).not.toHaveBeenCalled()
  })

  it('rejects a second preview generation for the same asset', async () => {
    const assets = [source]
    const library = createLibrary(assets)
    const previewFile = new File(['preview'], 'source.preview.mp4', { type: 'video/mp4' })
    let finishGeneration: (() => void) | undefined
    const generatePreviewFile = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finishGeneration = resolve
      })
      return { file: previewFile, cleanup: async () => {} }
    })
    library.importProxy = vi.fn(async () => {
      assets.push(proxy)
      return proxy
    })
    const catalog = createMediaAssetCatalogFromLibrary(library, {}, { generatePreviewFile })

    const firstGeneration = catalog.generatePreviewVersion(source.id)
    await vi.waitFor(() => expect(generatePreviewFile).toHaveBeenCalledTimes(1))

    await expect(catalog.generatePreviewVersion(source.id)).rejects.toThrow(
      `Preview generation is already running for media asset ${source.id}`,
    )

    finishGeneration?.()
    await expect(firstGeneration).resolves.toMatchObject({ proxyStatus: 'ready' })
  })

  it('requires protected protocols before removal', async () => {
    const library = createLibrary([source])
    const catalog = createMediaAssetCatalogFromLibrary(library)

    await expect(catalog.remove(source.id)).rejects.toThrow('requires getProtectedProtocols')
    expect(library.removeAsset).not.toHaveBeenCalled()
  })

  it('gets protected protocols itself when removing media', async () => {
    const protocol: IVideoProtocol = {
      id: 'project-1',
      version: '1.0.0',
      width: 1920,
      height: 1080,
      fps: 30,
      tracks: [],
    }
    const library = createLibrary([source])
    const catalog = createMediaAssetCatalogFromLibrary(library, {
      getProtectedProtocols: () => [protocol],
    })

    await catalog.remove(source.id)

    expect(library.removeAsset).toHaveBeenCalledWith(source.id, {
      protocols: [protocol],
      removeDerivatives: true,
    })
  })
})
