import { materializeFileSnapshot } from './media-processor'

describe('materializeFileSnapshot', () => {
  it('returns an independent in-memory file before temporary storage is removed', async () => {
    const source = new File(['rendition-bytes'], 'temporary.partial', {
      type: 'application/octet-stream',
      lastModified: 123,
    })

    const snapshot = await materializeFileSnapshot(source, 'video.video-h720-v1.mp4', 'video/mp4')

    expect(snapshot).not.toBe(source)
    expect(snapshot.name).toBe('video.video-h720-v1.mp4')
    expect(snapshot.type).toBe('video/mp4')
    expect(snapshot.lastModified).toBe(123)
    expect(await snapshot.text()).toBe('rendition-bytes')
  })
})
