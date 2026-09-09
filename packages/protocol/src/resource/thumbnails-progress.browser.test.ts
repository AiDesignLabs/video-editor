import { expect, it, vi } from 'vitest'
import { generateThumbnails } from './thumbnails'

const mocks = vi.hoisted(() => ({
  getCached: vi.fn(async () => undefined),
  opened: vi.fn(),
  finish: undefined as (() => void) | undefined,
}))
vi.mock('./cache', () => ({ getCachedResourceFile: mocks.getCached }))
vi.mock('@video-editor/media', () => ({
  openMediaInput: (source: string) => {
    mocks.opened(source)
    return {
      canDecodeVideo: async () => true,
      thumbnails: async (_width: number, options: { onThumbnail: (thumbnail: { tsMs: number, img: Blob }) => void }) => {
        const first = { tsMs: 0, img: new Blob(['first']) }
        options.onThumbnail(first)
        await new Promise<void>((resolve) => {
          mocks.finish = resolve
        })
        const second = { tsMs: 1000, img: new Blob(['second']) }
        options.onThumbnail(second)
        return [first, second]
      },
      dispose() {},
    }
  },
}))

it('publishes the first frame while later frames are pending, without waiting for a source cache write', async () => {
  const url = 'blob:progressive-test'
  const onThumbnail = vi.fn()
  const task = generateThumbnails(url, { start: 0, end: 2000000, step: 1000000, onThumbnail })
  await vi.waitFor(() => expect(onThumbnail).toHaveBeenCalledOnce())
  expect(mocks.opened).toHaveBeenCalledWith(url)
  expect(mocks.getCached).toHaveBeenCalledWith(url, expect.any(String), { waitForWrite: false })
  mocks.finish?.()
  await expect(task).resolves.toHaveLength(2)
  expect(onThumbnail).toHaveBeenCalledTimes(2)
})
