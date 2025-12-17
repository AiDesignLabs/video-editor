import { DEFAULT_RESOURCE_DIR, createResourceManager } from '.'
import { getResourceType } from './fetch'

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
})
