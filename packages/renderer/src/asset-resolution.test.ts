import type { IVideoProtocol } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { resolveProtocolAssetUrls } from './asset-resolution'

const protocol: IVideoProtocol = {
  id: 'protocol-1',
  version: '1.0.0',
  width: 1280,
  height: 720,
  fps: 30,
  tracks: [{
    trackId: 'frames-1',
    trackType: 'frames',
    isMain: true,
    children: [{
      id: 'segment-1',
      segmentType: 'frames',
      type: 'image',
      format: 'img',
      assetId: 'asset-1',
      url: 'https://old.example.com/image.png',
      startTime: 0,
      endTime: 1000,
    }],
  }],
}

describe('resolveProtocolAssetUrls', () => {
  it('uses the current URL without changing the source protocol', async () => {
    const resolved = await resolveProtocolAssetUrls(protocol, async (assetId, fallbackUrl) => {
      expect(assetId).toBe('asset-1')
      expect(fallbackUrl).toBe('https://old.example.com/image.png')
      return 'https://cdn.example.com/image.png'
    })

    expect(resolved.tracks[0].children[0].url).toBe('https://cdn.example.com/image.png')
    expect(protocol.tracks[0].children[0].url).toBe('https://old.example.com/image.png')
  })

  it('keeps the last-known URL when the resolver has no record', async () => {
    const resolved = await resolveProtocolAssetUrls(protocol, () => undefined)

    expect(resolved.tracks[0].children[0].url).toBe('https://old.example.com/image.png')
  })

  it('rejects an empty resolved URL', async () => {
    await expect(resolveProtocolAssetUrls(protocol, () => ''))
      .rejects
      .toThrow('empty URL for asset asset-1')
  })
})
