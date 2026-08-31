import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import TimelineToolbar from './TimelineToolbar.vue'
import { createDefaultToolbarActions } from './toolbar-actions'

function render(props: Record<string, unknown>, slots: Record<string, (props?: never) => unknown> = {}) {
  return renderToString(createSSRApp({ render: () => h(TimelineToolbar, props, slots) }))
}

function noop() {}

describe('timelineToolbar', () => {
  it('renders the zoom cluster and nothing else when no actions are given', async () => {
    const html = await render({ zoom: 1 })
    expect(html).toContain('i-creatly-zoom-out')
    expect(html).toContain('i-creatly-zoom-in')
    expect(html).not.toContain('i-creatly-undo')
  })

  it('renders declared actions into their zones with labels and disabled state', async () => {
    const actions = createDefaultToolbarActions({
      onUndo: noop,
      onRedo: noop,
      onTogglePlay: noop,
      canUndo: true,
      labels: { undo: 'Undo', redo: 'Redo' },
    })
    const html = await render({ zoom: 1, actions })

    expect(html).toContain('aria-label="Undo"')
    expect(html).toContain('aria-label="Redo"')
    expect(html).toContain('i-creatly-play')
    // `canRedo` was never set, so redo is the disabled one.
    expect(html).toMatch(/aria-label="Redo"[^>]*disabled|disabled[^>]*aria-label="Redo"/)
  })

  it('lets a consumer replace one action through its own slot', async () => {
    const actions = createDefaultToolbarActions({ onUndo: noop, zoom: false })
    const html = await render(
      { zoom: 1, actions },
      { 'action-undo': () => h('span', { class: 'custom-undo' }, 'mine') },
    )

    expect(html).toContain('custom-undo')
    expect(html).not.toContain('i-creatly-withdraw')
  })

  it('reserves a position for a slot action without rendering a button', async () => {
    const actions = [{ id: 'save', kind: 'slot' as const, group: 'left' as const, order: 10 }]
    const html = await render({ zoom: 1, actions }, { 'action-save': () => h('span', { class: 'save-cluster' }) })
    expect(html).toContain('save-cluster')
  })

  it('routes every button through the `button` slot when one is supplied', async () => {
    const actions = createDefaultToolbarActions({ onUndo: noop, onRedo: noop, zoom: false })
    const html = await render(
      { zoom: 1, actions },
      { button: ((slotProps: { action: { id: string } }) => h('em', { class: `host-${slotProps.action.id}` })) as unknown as () => unknown },
    )

    expect(html).toContain('host-undo')
    expect(html).toContain('host-redo')
    expect(html).not.toContain('class="ve-btn"')
  })

  it('keeps the zone slots winning over the action list', async () => {
    const actions = createDefaultToolbarActions({ onUndo: noop, zoom: false })
    const html = await render({ zoom: 1, actions }, { 'left-actions': () => h('span', { class: 'legacy' }) })
    expect(html).toContain('legacy')
    expect(html).not.toContain('i-creatly-withdraw')
  })

  it('drops a divider left dangling by an omitted action', async () => {
    // Only `undo` is supplied, so its leading divider has nothing to separate.
    const actions = createDefaultToolbarActions({ onUndo: noop, zoom: false })
    const html = await render({ zoom: 1, actions })
    expect(html).not.toContain('ve-toolbar-divider')
  })
})
