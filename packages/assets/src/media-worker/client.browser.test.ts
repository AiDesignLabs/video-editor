import type { VideoRenditionProfile } from '../types'
import TestMediaProcessorWorker from '../../test/media-processor-worker?worker&inline'
import { createWorkerMediaProcessor } from './client'

const TEST_PROFILES: readonly VideoRenditionProfile[] = [
  {
    id: 'video-h720-v1',
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    maxShortSide: 720,
    videoBitrate: 2_500_000,
    audioBitrate: 128_000,
    keyFrameIntervalMs: 2_000,
  },
  {
    id: 'video-h360-v1',
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    maxShortSide: 360,
    videoBitrate: 800_000,
    audioBitrate: 96_000,
    keyFrameIntervalMs: 2_000,
  },
]

describe('worker media processor browser RPC', () => {
  it('clones the source into a real Worker and returns progress and multiple Files', async () => {
    const progress = vi.fn()
    const processor = createWorkerMediaProcessor({ createWorker: () => new TestMediaProcessorWorker() })

    const renditions = await processor.process({
      source: new File(['source'], 'source.mp4', { type: 'video/mp4' }),
      profiles: TEST_PROFILES,
      onProgress: progress,
    })

    expect(progress).toHaveBeenCalledWith({ renditionId: 'video-h720-v1', renditionRatio: 0.5, completedRenditions: 0, totalRenditions: 1, ratio: 0.5, elapsedMs: 5 })
    expect(renditions.map(rendition => ({
      profileId: rendition.profileId,
      name: rendition.file.name,
      type: rendition.file.type,
      width: rendition.width,
      height: rendition.height,
    }))).toEqual([
      { profileId: 'video-h720-v1', name: 'video-h720-v1.mp4', type: 'video/mp4', width: 1280, height: 720 },
      { profileId: 'video-h360-v1', name: 'video-h360-v1.mp4', type: 'video/mp4', width: 640, height: 360 },
    ])
    await expect(renditions[0]!.file.text()).resolves.toBe('rendition-0')
    await expect(renditions[1]!.file.text()).resolves.toBe('rendition-1')
  })
})
