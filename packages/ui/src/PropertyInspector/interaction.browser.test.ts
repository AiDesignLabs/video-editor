import type { SegmentUnion } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import PropertyInspector from './index.vue'

const framesSegment = {
  id: 'seg-1',
  segmentType: 'frames',
  type: 'video',
  url: 'http://example.com/video.mp4',
  startTime: 0,
  endTime: 2000,
  fromTime: 0,
  opacity: 1,
} as unknown as SegmentUnion

interface Mounted {
  root: HTMLElement
  events: string[]
  unmount: () => void
}

function mount(segment: SegmentUnion | null = framesSegment): Mounted {
  const host = document.createElement('div')
  document.body.append(host)
  const events: string[] = []

  const app = createApp({
    render: () => h(PropertyInspector, {
      'segment': segment,
      'currentTimeMs': 0,
      'onInteractionStart': () => events.push('start'),
      'onInteractionEnd': () => events.push('end'),
      'onUpdate:segment': () => events.push('update'),
    }),
  })
  app.mount(host)

  return {
    root: host,
    events,
    unmount: () => {
      app.unmount()
      host.remove()
    },
  }
}

/** The first slider the inspector renders; the fields differ per segment type. */
function firstSlider(root: HTMLElement) {
  const slider = root.querySelector<HTMLInputElement>('input[type="range"]')
  if (!slider)
    throw new Error('the inspector rendered no slider')
  return slider
}

function fire(element: HTMLElement, type: string) {
  element.dispatchEvent(new Event(type, { bubbles: true }))
}

describe('propertyInspector interaction events', () => {
  it('brackets a slider drag with one start and one end', async () => {
    const { root, events, unmount } = mount()
    await nextTick()
    const slider = firstSlider(root)

    // A drag: many `input` events, then one `change` when the value commits.
    slider.value = '0.8'
    fire(slider, 'input')
    slider.value = '0.6'
    fire(slider, 'input')
    slider.value = '0.4'
    fire(slider, 'input')
    fire(slider, 'change')

    expect(events.filter(name => name === 'start')).toHaveLength(1)
    expect(events.filter(name => name === 'end')).toHaveLength(1)
    // The start must precede every update, and the end must follow all of them.
    expect(events[0]).toBe('start')
    expect(events.at(-1)).toBe('end')
    expect(events.filter(name => name === 'update').length).toBeGreaterThan(1)

    unmount()
  })

  it('opens a new interaction for a second drag', async () => {
    const { root, events, unmount } = mount()
    await nextTick()
    const slider = firstSlider(root)

    for (let i = 0; i < 2; i++) {
      slider.value = String(0.5 + i * 0.1)
      fire(slider, 'input')
      fire(slider, 'change')
    }

    expect(events.filter(name => name === 'start')).toHaveLength(2)
    expect(events.filter(name => name === 'end')).toHaveLength(2)

    unmount()
  })

  it('closes the interaction when focus leaves the field without a change event', async () => {
    const { root, events, unmount } = mount()
    await nextTick()
    const slider = firstSlider(root)

    slider.value = '0.3'
    fire(slider, 'input')
    expect(events).toContain('start')
    expect(events).not.toContain('end')

    slider.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))

    expect(events.filter(name => name === 'end')).toHaveLength(1)

    unmount()
  })

  it('does not emit anything until a field is actually edited', async () => {
    const { root, events, unmount } = mount()
    await nextTick()
    const slider = firstSlider(root)

    // Merely focusing must not open an interaction: an open transaction blocks
    // the host's undo, and a focused-but-untouched field is not an edit.
    slider.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(events).toEqual([])

    unmount()
  })

  it('closes an open interaction when the inspector unmounts mid-edit', async () => {
    const { root, events, unmount } = mount()
    await nextTick()
    const slider = firstSlider(root)

    slider.value = '0.2'
    fire(slider, 'input')
    expect(events.filter(name => name === 'end')).toHaveLength(0)

    unmount()

    // Otherwise the host is left holding a transaction nothing will ever close.
    expect(events.filter(name => name === 'end')).toHaveLength(1)
  })
})
