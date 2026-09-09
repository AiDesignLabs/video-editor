import type { GenerateThumbnailsOptions, Thumbnail } from '@video-editor/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import FramesSegment from './FramesSegment.vue'

const pending = vi.hoisted(() => ({ options: undefined as GenerateThumbnailsOptions | undefined, finish: undefined as ((shots: Thumbnail[]) => void) | undefined }))
vi.mock('@video-editor/protocol', () => ({
  generateThumbnails: vi.fn((_url: string, options: GenerateThumbnailsOptions) => {
    pending.options = options
    return new Promise<Thumbnail[]>((resolve) => {
      pending.finish = resolve
    })
  }),
  getMp4Meta: vi.fn(async () => ({ audioChanCount: 0 })),
  extractWaveform: vi.fn(),
}))

describe('progressive timeline thumbnails', () => {
  it('shows the cover before extraction and paints a partial frame before the job completes', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:448px;height:64px'
    document.body.append(host)
    const cover = 'data:image/png;base64,iVBORw0KGgo='
    const app = createApp({ render: () => h(FramesSegment, { coverUrl: cover, segment: {
      id: 'long-video',
      segmentType: 'frames',
      type: 'video',
      url: 'https://example.com/large.mov',
      startTime: 0,
      endTime: 600000,
      fromTime: 0,
    } }) })
    app.mount(host)
    try {
      await vi.waitFor(() => expect(host.querySelector('.frames-segment__thumb')).not.toBeNull())
      expect((host.querySelector('.frames-segment__thumb') as HTMLElement).style.backgroundImage).toContain('data:image/png')
      await vi.waitFor(() => expect(pending.options).toBeDefined())
      const shot = { ts: 0, img: new Blob(['frame'], { type: 'image/png' }) }
      pending.options?.onThumbnail?.(shot)
      await nextTick()
      expect((host.querySelector('.frames-segment__thumb') as HTMLElement).style.backgroundImage).toContain('blob:')
      expect(host.querySelector('.frames-segment__placeholder')).toBeNull()
      pending.finish?.([shot])
      await nextTick()
    }
    finally {
      app.unmount()
      host.remove()
    }
  })
})
