import { describe, expect, it } from 'vitest'
import { videoThumbnailExtractionModel } from './videoThumbnailExtractionModel'

describe('videoThumbnailExtractionModel', () => {
  it('keeps the extraction endpoint inside the source range', () => {
    const options = videoThumbnailExtractionModel.resolveOptions({
      url: 'https://example.com/video.mp4',
      startTime: 0,
      endTime: 10_000,
      fromTime: 0,
      playRate: 1,
    }, 10_000_000)

    expect(options).toEqual({ start: 0, end: 9_999_999, step: 1_249_999 })
  })

  it('maps trimmed accelerated ranges to source time', () => {
    const options = videoThumbnailExtractionModel.resolveOptions({
      url: 'https://example.com/video.mp4',
      startTime: 5_000,
      endTime: 7_000,
      fromTime: 4_000,
      playRate: 2,
    }, 20_000_000)

    expect(options).toEqual({ start: 4_000_000, end: 8_000_000, step: 500_000 })
  })
})
