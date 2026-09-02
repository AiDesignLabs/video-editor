import type { IImageFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { dir as opfsDir, file as opfsFile, write as opfsWrite } from 'opfs-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { getResourceKey } from '../resource/key'
import { createAssetLibrary } from './index'

const resourceDir = '/video-editor-res/asset-library-test'
const manifestDir = '/video-editor-assets-test'
const manifestPath = `${manifestDir}/manifest.json`

function createLibrary() {
  return createAssetLibrary({ resourceDir, manifestDir })
}

async function createPngFile(name: string, width = 4, height = 3) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('2d context unavailable')
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, width, height)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new File([blob], name, { type: 'image/png' })
}

async function removeDir(path: string) {
  const directory = opfsDir(path)
  if (await directory.exists())
    await directory.remove()
}

describe('asset library', () => {
  afterEach(async () => {
    await removeDir(resourceDir)
    await removeDir(manifestDir)
  })

  it('imports an image file and records its dimensions', async () => {
    const library = createLibrary()
    const meta = await library.importAsset(await createPngFile('logo.png', 6, 4))

    expect(meta.kind).toBe('image')
    expect(meta.name).toBe('logo.png')
    expect(meta.url.startsWith('local-asset://')).toBe(true)
    expect(meta.width).toBe(6)
    expect(meta.height).toBe(4)
    expect(meta.sizeBytes).toBeGreaterThan(0)

    const assets = await library.listAssets()
    expect(assets).toHaveLength(1)
    expect(assets[0].id).toBe(meta.id)

    const originFile = await library.getAssetFile(meta.id)
    expect(originFile).toBeDefined()
    expect(originFile?.size).toBe(meta.sizeBytes)
  })

  it('lists assets newest first', async () => {
    const library = createLibrary()
    const first = await library.importAsset(await createPngFile('first.png'))
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await library.importAsset(await createPngFile('second.png'))

    const assets = await library.listAssets()
    expect(assets.map(asset => asset.id)).toEqual([second.id, first.id])
  })

  it('removes an asset from the manifest and from OPFS', async () => {
    const library = createLibrary()
    const meta = await library.importAsset(await createPngFile('removable.png'))

    await library.removeAsset(meta.id, { protocols: [] })

    expect(await library.listAssets()).toEqual([])
    expect(await library.getAssetFile(meta.id)).toBeUndefined()
  })

  it('tolerates a corrupt manifest', async () => {
    const garbage = new Blob(['{ not json at all'], { type: 'application/json' })
    await opfsWrite(manifestPath, garbage.stream(), { overwrite: true })

    const library = createLibrary()
    await expect(library.listAssets()).resolves.toEqual([])
  })

  it('imports audio even when metadata probing fails', async () => {
    const library = createLibrary()
    const notReallyAudio = new File([new Uint8Array([1, 2, 3, 4])], 'broken.wav', { type: 'audio/wav' })

    const meta = await library.importAsset(notReallyAudio)

    expect(meta.kind).toBe('audio')
    expect(meta.durationMs).toBeUndefined()
    expect((await library.listAssets()).map(asset => asset.id)).toEqual([meta.id])
  })

  it('rejects unsupported file kinds', async () => {
    const library = createLibrary()
    const doc = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    await expect(library.importAsset(doc)).rejects.toThrow(/Unsupported asset type/)
  })

  it('resolves a stable id after the asset URL changes', async () => {
    const library = createLibrary()
    const meta = await library.importAsset(await createPngFile('relinked.png'))

    const updated = await library.relinkAsset(meta.id, 'https://cdn.example.com/relinked.png')

    expect(updated.id).toBe(meta.id)
    expect(updated.previousUrls).toEqual([meta.url])
    expect(await library.resolveAssetUrl(meta.id)).toBe('https://cdn.example.com/relinked.png')
    expect((await library.getAsset(meta.id))?.url).toBe('https://cdn.example.com/relinked.png')
  })

  it('tracks a proxy against the source revision and stops using it when stale', async () => {
    const library = createLibrary()
    const source = await library.importAsset(await createPngFile('source.png', 8, 6))
    const proxy = await library.importProxy(source.id, await createPngFile('proxy.png', 4, 3), 'editing-mp4-v1')

    expect(proxy.derivation).toEqual({
      kind: 'proxy',
      sourceAssetId: source.id,
      sourceRevision: 1,
      profile: 'editing-mp4-v1',
    })
    expect((await library.listAssetDerivatives(source.id)).map(asset => asset.id)).toEqual([proxy.id])
    expect(await library.isAssetDerivativeStale(proxy.id)).toBe(false)
    expect(await library.resolveAssetUrl(source.id, { preferProxy: true })).toBe(proxy.url)
    expect(await library.resolveAssetUrl(source.id, {
      preferProxy: true,
      proxyProfile: 'legacy-profile',
    })).toBe(source.url)
    expect(await library.resolveAssetUrl(source.id)).toBe(source.url)

    await expect(library.removeAsset(source.id, { protocols: [] }))
      .rejects
      .toThrow(`derived asset(s) still exist: ${proxy.id}`)

    const updated = await library.relinkAsset(source.id, 'https://cdn.example.com/source-v2.png')

    expect(updated.revision).toBe(2)
    expect(await library.isAssetDerivativeStale(proxy.id)).toBe(true)
    expect(await library.resolveAssetUrl(source.id, { preferProxy: true })).toBe(updated.url)
    expect(await library.resolveAssetUrl(proxy.id)).toBe(updated.url)

    await library.removeAsset(source.id, { protocols: [], removeDerivatives: true })
    expect(await library.listAssets()).toEqual([])
  })

  it('clears derived thumbnail storage when an asset is relinked', async () => {
    const library = createLibrary()
    const source = await library.importAsset(await createPngFile('cached.png'))
    const thumbnailDir = `${resourceDir}/thumbnails/${getResourceKey(source.url)}`
    const cachedThumbnail = `${thumbnailDir}/variant/0.png`
    await opfsWrite(cachedThumbnail, new Blob(['cached']).stream(), { overwrite: true })
    expect(await opfsFile(cachedThumbnail, 'r').exists()).toBe(true)

    await library.relinkAsset(source.id, 'https://cdn.example.com/cached-v2.png')

    expect(await opfsDir(thumbnailDir).exists()).toBe(false)
  })

  it('keeps legacy URL references protected after relinking', async () => {
    const library = createLibrary()
    const meta = await library.importAsset(await createPngFile('legacy.png'))
    await library.relinkAsset(meta.id, 'https://cdn.example.com/legacy.png')
    const protocol: IVideoProtocol = {
      id: 'legacy-project',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [{
        trackId: 'frames-1',
        trackType: 'frames',
        isMain: true,
        children: [{
          id: 'legacy-segment',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: meta.url,
          startTime: 0,
          endTime: 1000,
        }],
      }],
    }

    await expect(library.removeAsset(meta.id, { protocols: [protocol] }))
      .rejects
      .toThrow('referenced by segment(s): legacy-segment')
  })

  it('refuses deletion when a current or legacy segment references the asset', async () => {
    const library = createLibrary()
    const meta = await library.importAsset(await createPngFile('used.png'))
    const protocol: IVideoProtocol = {
      id: 'project-1',
      version: '1.0.0' as const,
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [{
        trackId: 'frames-1',
        trackType: 'frames' as const,
        isMain: true,
        children: [{
          id: 'segment-1',
          segmentType: 'frames' as const,
          type: 'image' as const,
          format: 'img' as const,
          assetId: meta.id,
          url: 'https://stale.example.com/used.png',
          startTime: 0,
          endTime: 1000,
        }],
      }],
    }

    await expect(library.removeAsset(meta.id, { protocols: [protocol] }))
      .rejects
      .toThrow(`referenced by segment(s): segment-1`)
    expect(await library.getAsset(meta.id)).toBeDefined()

    const segment = protocol.tracks[0].children[0] as IImageFramesSegment
    delete segment.assetId
    segment.url = meta.url
    await expect(library.removeAsset(meta.id, { protocols: [protocol] }))
      .rejects
      .toThrow(`referenced by segment(s): segment-1`)
  })
})
