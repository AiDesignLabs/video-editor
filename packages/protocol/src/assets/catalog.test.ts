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
    })
    await expect(catalog.resolveForPreview(source.id)).resolves.toBe(proxy.url)
    await expect(catalog.resolveForExport(source.id)).resolves.toBe(source.url)
    await expect(catalog.getPreviewBlob(source.id)).resolves.toBe(preview)
    expect(library.getAssetFile).toHaveBeenCalledWith(source.id, { preferProxy: true })
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
