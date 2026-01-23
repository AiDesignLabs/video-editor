/// <reference types="vitest" />
import { DEFAULT_RESOURCE_DIR, createResourceManager } from '.'
import { dir as opfsDir, file as opfsFile, write as opfsWrite } from 'opfs-tools'
import { getResourceType } from './fetch'
import { getResourceKey } from './key'
import { generateThumbnails } from './thumbnails'
import { beforeEach, describe, expect, it } from 'vitest'

describe('resource manager', () => {
  const manager = createResourceManager()
  const imgUrl = 'https://mogic-static.oss-cn-hangzhou.aliyuncs.com/Aogen/user-avatar.png'
  const videoUrl = 'https://mogic-static.oss-cn-hangzhou.aliyuncs.com/test/output.mp4'
  const notFoundUrl = 'https://mogic-static.oss-cn-hangzhou.aliyuncs.com/not-found.png'
  const notSupportUrl = 'https://mogic-static.oss-cn-hangzhou.aliyuncs.com/subtitle-transtion/vc-upload-1683964073583-22.pag'
  const imgUrlQuery1 = `${imgUrl}?v=1`
  const imgUrlQuery2 = `${imgUrl}?v=2`

  describe('get resource type', () => {
    it('should return image if url is image', async () => {
      const { type } = await getResourceType(imgUrl)
      expect(type).toBe('image')
    })

    it('should return video if url is video', async () => {
      const { type } = await getResourceType(videoUrl)
      expect(type).toBe('video')
    })

    it('invalid url', async () => {
      const url = 'invalid url'
      await expect(getResourceType(url)).rejects.toThrow('Invalid URL')
    })

    it('not found url', async () => {
      await expect(getResourceType(notFoundUrl)).rejects.toThrow('Resource not found')
    })

    it('not support type', async () => {
      await expect(getResourceType(notSupportUrl)).rejects.toThrow('Resource type not support')
    })
  })

  describe('add resource', () => {
    it('with image', async () => {
      await manager.add(imgUrl)
      const img = await manager.get(imgUrl)
      expect(img instanceof HTMLImageElement).toBeTruthy()
    })

    it('with video', async () => {
      await manager.add(videoUrl)
      const samples = await manager.get(videoUrl)
      expect(Array.isArray(samples) && Array.isArray(samples[0].samples) && samples[0].type).toBeTruthy()
    })

    // TODO: support more resource type, such as audio, subtitle, etc.

    it('breakpoint continue save', async () => {
      // TODO: support breakpoint continue save
      expect(true).toBeTruthy()
    })
  })

  describe('key normalization', () => {
    it('treats query variations as same cache entry', async () => {
      const keyManager = createResourceManager({ dir: `${DEFAULT_RESOURCE_DIR}/test-key-normalization` })
      await keyManager.clear()

      await keyManager.add(imgUrlQuery1)
      const img = await keyManager.get(imgUrlQuery2)
      expect(img instanceof HTMLImageElement).toBeTruthy()

      await keyManager.remove(imgUrlQuery2)
      expect(await keyManager.get(imgUrlQuery1)).toBeUndefined()
    })
  })

  describe('get resource', () => {
    it('should return null if resource not found', async () => {
      const res = await manager.get('')
      expect(res).toBeUndefined()
    })

    it('with image', async () => {
      const img = await manager.get(imgUrl)
      expect(img instanceof HTMLImageElement).toBeTruthy()
    })

    it('with video', async () => {
      const samples = await manager.get(videoUrl)
      expect(Array.isArray(samples) && Array.isArray(samples[0].samples) && samples[0].type).toBeTruthy()
    })

    // TODO: support more resource type, such as audio, subtitle, etc.

    it('not support type url', async () => {
      expect(await manager.get(notSupportUrl)).toBeUndefined()
    })

    it('not found url', async () => {
      expect(await manager.get(notFoundUrl)).toBeUndefined()
    })

    it('invalid file data url', async () => {
      // TODO: support invalid file data check
      expect(true).toBeTruthy()
    })
  })

  describe('thumbnails', () => {
    it('returns empty list for non-video url', async () => {
      const thumbs = await generateThumbnails(imgUrl)
      expect(Array.isArray(thumbs) && thumbs.length === 0).toBeTruthy()
    })

    describe('opfs cache', () => {
      const resourceDir = `${DEFAULT_RESOURCE_DIR}/thumb-cache-test`
      const key = getResourceKey(videoUrl)
      const start = 0
      const end = 600_000
      const step = 300_000
      const imgWidth = 64
      const variantKey = `${imgWidth}-${start}-${end}-${step}`
      const baseDir = `${resourceDir}/thumbnails/${key}/${variantKey}`
      const manifestPath = `${baseDir}/manifest.json`
      const indexPath = `${resourceDir}/thumbnails/${key}/index.json`

      async function readJson(path: string) {
        const file = opfsFile(path, 'r')
        if (!(await file.exists()))
          return undefined
        const origin = await file.getOriginFile()
        if (!origin)
          return undefined
        return JSON.parse(await origin.text()) as any
      }

      async function waitForJson(path: string, predicate?: (value: any) => boolean, timeoutMs = 2000, intervalMs = 50) {
        const start = performance.now()
        while (performance.now() - start < timeoutMs) {
          const value = await readJson(path)
          if (value !== undefined && (!predicate || predicate(value)))
            return value
          await new Promise(resolve => setTimeout(resolve, intervalMs))
        }
        return undefined
      }

      beforeEach(async () => {
        const dir = opfsDir(resourceDir)
        if (await dir.exists())
          await dir.remove()
      })

      it('writes manifest and index to OPFS', async () => {
        const thumbs = await generateThumbnails(videoUrl, { imgWidth, start, end, step, resourceDir })
        expect(thumbs.length).toBeGreaterThan(0)

        const manifest = await waitForJson(manifestPath)
        expect(manifest && Array.isArray(manifest.items)).toBeTruthy()

        const index = await waitForJson(indexPath)
        expect(Array.isArray(index)).toBeTruthy()
        expect(index[0]?.baseDir).toBe(baseDir)
      })

      it('invalidates cache when TTL expires', async () => {
        const ttlResourceDir = `${DEFAULT_RESOURCE_DIR}/thumb-cache-ttl-test`
        const ttlVariantKey = `${imgWidth}-${start}-${end}-${step}`
        const ttlBaseDir = `${ttlResourceDir}/thumbnails/${key}/${ttlVariantKey}`
        const ttlManifestPath = `${ttlBaseDir}/manifest.json`

        const oldCreatedAt = Date.now() - 1000 * 60 * 60 * 24 * 8
        const dummyPath = `${ttlBaseDir}/0.png`
        await opfsWrite(dummyPath, new Blob(['x']).stream(), { overwrite: true })
        const staleManifest = {
          version: 1,
          createdAt: oldCreatedAt,
          items: [{ ts: 0, path: dummyPath }],
        }
        await opfsWrite(ttlManifestPath, new Blob([JSON.stringify(staleManifest)]).stream(), { overwrite: true })

        await generateThumbnails(videoUrl, { imgWidth, start, end, step, resourceDir: ttlResourceDir })
        const after = await waitForJson(ttlManifestPath, value => typeof value?.createdAt === 'number' && value.createdAt > oldCreatedAt, 4000)
        expect(after?.createdAt).toBeGreaterThan(oldCreatedAt)
      })

      it('evicts least-recent variants beyond max entries', async () => {
        const variants = Array.from({ length: 7 }).map((_, idx) => ({
          imgWidth: imgWidth + idx,
          start,
          end,
          step,
        }))

        for (const opts of variants)
          await generateThumbnails(videoUrl, { ...opts, resourceDir })

        const index = await readJson(indexPath)
        expect(Array.isArray(index)).toBeTruthy()
        expect(index.length).toBeLessThanOrEqual(6)
      })
    })
  })
})
