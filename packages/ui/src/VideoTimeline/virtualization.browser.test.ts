import type { SegmentLayout, TimelineTrack } from './types'
import { describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import VideoTimeline from './index.vue'

const tracks: TimelineTrack[] = [{
  id: 'frames',
  type: 'frames',
  isMain: true,
  segments: Array.from({ length: 100 }, (_, index) => ({
    id: `segment-${index}`,
    type: 'video',
    start: index * 1000,
    end: (index + 1) * 1000,
  })),
}]

async function nextFrame() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  await nextTick()
}

describe('videoTimeline virtualization', () => {
  it('mounts the buffered range and preserves a segment being resized', async () => {
    const host = document.createElement('div')
    host.style.width = '1000px'
    host.style.height = '240px'
    document.body.append(host)

    const app = createApp({
      render: () => h(VideoTimeline, {
        tracks,
        currentTime: 0,
        duration: 100_000,
        zoom: 10,
        selectedSegmentId: 'segment-0',
      }, {
        segment: ({ layout }: { layout: SegmentLayout }) => h('span', {
          'data-segment-id': layout.segment.id,
        }),
      }),
    })

    app.mount(host)
    const viewport = host.querySelector<HTMLElement>('.ve-timeline__viewport')
    if (!viewport)
      throw new Error('the timeline rendered no scroll viewport')
    // UnoCSS is bundled by the package build, but this isolated SFC test only
    // loads the Vue plugin. Supply the generated width and overflow behaviour.
    viewport.style.width = '300px'
    viewport.style.overflow = 'auto'
    await nextFrame()
    await nextFrame()

    const renderedIds = () => Array.from(host.querySelectorAll<HTMLElement>('[data-segment-id]'))
      .map(element => element.dataset.segmentId)

    expect(renderedIds()).toContain('segment-0')
    expect(renderedIds().length).toBeLessThan(25)

    const resizeHandle = host.querySelector<HTMLElement>('.ve-segment__handle--left')
    if (!resizeHandle)
      throw new Error('the selected segment rendered no resize handle')
    resizeHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0 }))

    expect(viewport.scrollWidth).toBeGreaterThan(2500)
    viewport.scrollLeft = 2500
    expect(viewport.scrollLeft).toBeGreaterThan(2000)
    viewport.dispatchEvent(new Event('scroll'))
    await nextFrame()

    const scrolledIds = renderedIds()
    expect(scrolledIds).toContain('segment-0')
    expect(scrolledIds).toContain('segment-90')
    expect(scrolledIds).not.toContain('segment-20')
    expect(scrolledIds.length).toBeLessThan(30)

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 0 }))
    app.unmount()
    host.remove()
  })
})
