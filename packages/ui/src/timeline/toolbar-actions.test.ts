import type { ToolbarAction } from './toolbar-actions'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultToolbarActions, mergeToolbarActions, resolveToolbarGroup } from './toolbar-actions'

function ids(actions: ToolbarAction[]) {
  return actions.map(action => action.id)
}

describe('createDefaultToolbarActions', () => {
  it('emits only the actions whose handler was supplied', () => {
    const actions = createDefaultToolbarActions({ onUndo: () => {}, zoom: false })
    expect(ids(actions)).toEqual(['history-divider', 'undo'])
  })

  it('lays the full set out across the three zones', () => {
    const noop = () => {}
    const actions = createDefaultToolbarActions({
      onAdd: noop,
      onDelete: noop,
      onSplit: noop,
      onUndo: noop,
      onRedo: noop,
      onTogglePlay: noop,
      onStepBackward: noop,
      onStepForward: noop,
      onToggleMute: noop,
    })

    expect(ids(resolveToolbarGroup(actions, 'left'))).toEqual([
      'add',
      'edit-divider',
      'delete',
      'split',
      'history-divider',
      'undo',
      'redo',
    ])
    expect(ids(resolveToolbarGroup(actions, 'center'))).toEqual(['play'])
    expect(ids(resolveToolbarGroup(actions, 'right'))).toEqual([
      'step-backward',
      'step-forward',
      'transport-divider',
      'zoom',
      'mute',
    ])
  })

  it('disables selection-scoped actions until something is selected', () => {
    const noop = () => {}
    const withoutSelection = createDefaultToolbarActions({ onSplit: noop })
    const withSelection = createDefaultToolbarActions({ onSplit: noop, hasSelection: true })

    expect(withoutSelection.find(a => a.id === 'split')).toMatchObject({ disabled: true })
    expect(withSelection.find(a => a.id === 'split')).toMatchObject({ disabled: false })
  })

  it('flips the transport and mute icons with their state', () => {
    const noop = () => {}
    const playing = createDefaultToolbarActions({ onTogglePlay: noop, isPlaying: true, onToggleMute: noop, muted: true })
    expect(playing.find(a => a.id === 'play')).toMatchObject({ icon: 'i-creatly-pause' })
    expect(playing.find(a => a.id === 'mute')).toMatchObject({ icon: 'i-creatly-mute' })
  })

  it('lets labels be overridden for translation', () => {
    const actions = createDefaultToolbarActions({ onUndo: () => {}, labels: { undo: 'Undo' }, titles: { undo: 'Undo (⌘Z)' } })
    expect(actions.find(a => a.id === 'undo')).toMatchObject({ label: 'Undo', title: 'Undo (⌘Z)' })
  })
})

describe('resolveToolbarGroup', () => {
  it('drops dividers that no longer separate anything', () => {
    const actions: ToolbarAction[] = [
      { id: 'lead', kind: 'divider', group: 'left', order: 0 },
      { id: 'a', group: 'left', order: 10, icon: 'i-a', label: 'a', onSelect: () => {} },
      { id: 'mid', kind: 'divider', group: 'left', order: 20 },
      { id: 'dupe', kind: 'divider', group: 'left', order: 25 },
      { id: 'b', group: 'left', order: 30, icon: 'i-b', label: 'b', onSelect: () => {} },
      { id: 'trail', kind: 'divider', group: 'left', order: 40 },
    ]
    expect(ids(resolveToolbarGroup(actions, 'left'))).toEqual(['a', 'mid', 'dupe', 'b'])
  })

  it('skips hidden actions and treats a missing group as left', () => {
    const actions: ToolbarAction[] = [
      { id: 'a', icon: 'i-a', label: 'a', onSelect: () => {} },
      { id: 'b', hidden: true, icon: 'i-b', label: 'b', onSelect: () => {} },
    ]
    expect(ids(resolveToolbarGroup(actions, 'left'))).toEqual(['a'])
  })
})

describe('mergeToolbarActions', () => {
  const base = createDefaultToolbarActions({
    onAdd: () => {},
    onSplit: () => {},
    onUndo: () => {},
    zoom: false,
  })

  it('removes and overrides by id', () => {
    const merged = mergeToolbarActions(base, {
      remove: ['add'],
      override: { split: { disabled: true } },
    })
    expect(ids(merged)).not.toContain('add')
    expect(merged.find(a => a.id === 'split')).toMatchObject({ disabled: true })
  })

  it('inserts a business action after a built-in', () => {
    const merged = mergeToolbarActions(base, {
      add: [{ id: 'duplicate', icon: 'i-copy', label: 'Duplicate', onSelect: () => {}, after: 'split' }],
    })
    expect(ids(resolveToolbarGroup(merged, 'left'))).toEqual([
      'add',
      'edit-divider',
      'split',
      'duplicate',
      'history-divider',
      'undo',
    ])
  })

  it('inserts before an anchor', () => {
    const merged = mergeToolbarActions(base, {
      add: [{ id: 'locate', icon: 'i-pin', label: 'Locate', onSelect: () => {}, before: 'split' }],
    })
    expect(ids(resolveToolbarGroup(merged, 'left'))).toEqual([
      'add',
      'edit-divider',
      'locate',
      'split',
      'history-divider',
      'undo',
    ])
  })

  it('appends when the anchor is unknown rather than throwing', () => {
    const merged = mergeToolbarActions(base, {
      add: [{ id: 'x', group: 'right', icon: 'i-x', label: 'x', onSelect: () => {}, after: 'nope' }],
    })
    expect(ids(resolveToolbarGroup(merged, 'right'))).toEqual(['x'])
  })

  it('leaves the base list untouched', () => {
    const snapshot = ids(base)
    mergeToolbarActions(base, { remove: ['add'], add: [{ id: 'y', icon: 'i-y', label: 'y', onSelect: () => {} }] })
    expect(ids(base)).toEqual(snapshot)
  })

  it('keeps the merged handlers callable', () => {
    const onSelect = vi.fn()
    const merged = mergeToolbarActions(base, { add: [{ id: 'z', icon: 'i-z', label: 'z', onSelect, after: 'undo' }] })
    const added = merged.find(a => a.id === 'z')
    expect(added?.kind).toBeUndefined()
    ;(added as { onSelect: (event: MouseEvent) => void }).onSelect({} as MouseEvent)
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
