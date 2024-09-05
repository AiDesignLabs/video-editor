import { createResourceManager } from '.'

describe('video protocol basic info', () => {
  const manager = createResourceManager()

  describe('get', () => {
    it('should return null if resource not found', async () => {
      const res = await manager.get('')
      expect(res).toBeUndefined()
    })

    it('should return resource if found', async () => {
      const url = 'https://mogic-static.oss-cn-hangzhou.aliyuncs.com/Aogen/user-avatar.png'
      await manager.add(url)
      manager.get(url)
    })
  })
})
