/**
 * Declarative toolbar model.
 *
 * The timeline toolbar has to serve two masters: this repo's own editor, which
 * wants the full CapCut-style control strip, and business apps that embed the
 * timeline and need buttons this repo knows nothing about (jump to a graph
 * node, duplicate through their own document model, a cloud-save indicator).
 *
 * Slots alone did not scale for that: a consumer who wanted one extra button
 * had to re-declare the whole zone, re-implementing the built-ins by hand and
 * then drifting from them. So the toolbar is driven by a list of plain action
 * descriptors instead. The package ships the standard set through
 * `createDefaultToolbarActions()`, the consumer reshapes it with
 * `mergeToolbarActions()`, and anything the descriptors cannot express falls
 * back to a per-action slot. The old zone slots still win when present, so
 * existing embeds keep working.
 */

export type ToolbarActionGroup = 'left' | 'center' | 'right'

interface ToolbarActionBase {
  /** Stable identity: used for slot names, merging and Vue keys. */
  id: string
  /** Which end of the toolbar the action sits in. Defaults to `left`. */
  group?: ToolbarActionGroup
  /**
   * Sort key within the group. Built-ins are spaced by 10 so a consumer can
   * slot an action between two of them without renumbering anything.
   */
  order?: number
  /** Declared but not rendered. Cheaper than filtering in every consumer. */
  hidden?: boolean
}

export interface ToolbarButtonAction extends ToolbarActionBase {
  kind?: 'button'
  /** Icon class, e.g. `i-creatly-cutting`. */
  icon: string
  /** Accessible name; also the default tooltip. */
  label: string
  /** Tooltip, when it should say more than `label` (e.g. name the shortcut). */
  title?: string
  disabled?: boolean
  /** Renders the pressed/on state, e.g. a toggle that is currently on. */
  active?: boolean
  /** Higher-contrast variant, used for the primary transport button. */
  strong?: boolean
  /**
   * The click event is forwarded so a host can anchor a popover to the button
   * it came from; ignore it when you do not need it.
   */
  onSelect: (event: MouseEvent) => void
}

/** A hairline separator. Redundant ones are dropped at render time. */
export interface ToolbarDividerAction extends ToolbarActionBase {
  kind: 'divider'
}

/** Non-interactive text, optionally with a leading icon (e.g. save state). */
export interface ToolbarStatusAction extends ToolbarActionBase {
  kind: 'status'
  icon?: string
  text: string
}

/**
 * The built-in zoom cluster (out / slider / in). Modelled as an action so it
 * can be reordered or dropped like any other, rather than being pinned to the
 * right edge by the template.
 */
export interface ToolbarZoomAction extends ToolbarActionBase {
  kind: 'zoom'
  /** Hide the slider and keep only the two buttons. */
  slider?: boolean
}

/**
 * Reserves a position that the consumer fills through the `action-<id>` slot.
 * For controls the descriptors cannot describe — a dropdown, a menu, a popover.
 */
export interface ToolbarSlotAction extends ToolbarActionBase {
  kind: 'slot'
}

export type ToolbarAction
  = | ToolbarButtonAction
    | ToolbarDividerAction
    | ToolbarStatusAction
    | ToolbarZoomAction
    | ToolbarSlotAction

export type DefaultToolbarActionId
  = | 'add'
    | 'delete'
    | 'split'
    | 'undo'
    | 'redo'
    | 'play'
    | 'step-backward'
    | 'step-forward'
    | 'mute'

/**
 * Handlers and state for the standard action set. Every handler is optional:
 * an action whose handler is missing is not emitted at all, which is how an
 * embed opts out of a capability it cannot support.
 */
export interface DefaultToolbarActionsContext {
  onAdd?: (event: MouseEvent) => void
  onDelete?: () => void
  onSplit?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onTogglePlay?: () => void
  onStepBackward?: () => void
  onStepForward?: () => void
  onToggleMute?: () => void

  hasSelection?: boolean
  canUndo?: boolean
  canRedo?: boolean
  canPlay?: boolean
  canStep?: boolean
  isPlaying?: boolean
  muted?: boolean

  /** Set to `false` to leave the zoom cluster out entirely. */
  zoom?: boolean
  /** Set to `false` to keep the zoom buttons but drop the slider. */
  zoomSlider?: boolean

  /** Overrides for the built-in accessible names, for i18n. */
  labels?: Partial<Record<DefaultToolbarActionId | 'pause' | 'unmute', string>>
  /** Overrides for the built-in tooltips, for i18n. */
  titles?: Partial<Record<DefaultToolbarActionId | 'pause' | 'unmute', string>>
}

const DEFAULT_LABELS: Record<string, string> = {
  'add': '添加素材',
  'delete': '删除',
  'split': '分割',
  'undo': '撤销',
  'redo': '重做',
  'play': '播放',
  'pause': '暂停',
  'step-backward': '上一帧',
  'step-forward': '下一帧',
  'mute': '静音',
  'unmute': '取消静音',
}

const DEFAULT_TITLES: Record<string, string> = {
  delete: '删除选中片段 (Delete)',
  split: '在播放头处分割 (Cmd/Ctrl+B)',
  undo: '撤销 (Cmd/Ctrl+Z)',
  redo: '重做 (Cmd/Ctrl+Shift+Z)',
  play: '播放 (空格)',
  pause: '暂停 (空格)',
}

/**
 * Builds the standard toolbar: add / delete+split / undo+redo on the left, the
 * transport button in the centre, frame stepping and mute on the right.
 *
 * Dividers are emitted between the built-in clusters; `TimelineToolbar` drops
 * the ones that end up leading, trailing or doubled once optional actions have
 * been omitted, so callers never have to reason about them.
 */
export function createDefaultToolbarActions(ctx: DefaultToolbarActionsContext = {}): ToolbarAction[] {
  const label = (id: string) => ctx.labels?.[id as DefaultToolbarActionId] ?? DEFAULT_LABELS[id] ?? id
  const title = (id: string) => ctx.titles?.[id as DefaultToolbarActionId] ?? DEFAULT_TITLES[id] ?? label(id)

  const actions: ToolbarAction[] = []

  if (ctx.onAdd) {
    actions.push({
      id: 'add',
      group: 'left',
      order: 10,
      icon: 'i-creatly-add',
      label: label('add'),
      title: title('add'),
      onSelect: ctx.onAdd,
    })
  }

  if (ctx.onDelete || ctx.onSplit)
    actions.push({ id: 'edit-divider', kind: 'divider', group: 'left', order: 20 })

  if (ctx.onDelete) {
    actions.push({
      id: 'delete',
      group: 'left',
      order: 30,
      icon: 'i-creatly-clear',
      label: label('delete'),
      title: title('delete'),
      disabled: !ctx.hasSelection,
      onSelect: ctx.onDelete,
    })
  }

  if (ctx.onSplit) {
    actions.push({
      id: 'split',
      group: 'left',
      order: 40,
      icon: 'i-creatly-cutting',
      label: label('split'),
      title: title('split'),
      disabled: !ctx.hasSelection,
      onSelect: ctx.onSplit,
    })
  }

  if (ctx.onUndo || ctx.onRedo)
    actions.push({ id: 'history-divider', kind: 'divider', group: 'left', order: 50 })

  if (ctx.onUndo) {
    actions.push({
      id: 'undo',
      group: 'left',
      order: 60,
      icon: 'i-creatly-withdraw',
      label: label('undo'),
      title: title('undo'),
      disabled: !ctx.canUndo,
      onSelect: ctx.onUndo,
    })
  }

  if (ctx.onRedo) {
    actions.push({
      id: 'redo',
      group: 'left',
      order: 70,
      icon: 'i-creatly-advance',
      label: label('redo'),
      title: title('redo'),
      disabled: !ctx.canRedo,
      onSelect: ctx.onRedo,
    })
  }

  if (ctx.onTogglePlay) {
    const playing = Boolean(ctx.isPlaying)
    actions.push({
      id: 'play',
      group: 'center',
      order: 10,
      icon: playing ? 'i-creatly-pause' : 'i-creatly-play',
      label: label(playing ? 'pause' : 'play'),
      title: title(playing ? 'pause' : 'play'),
      // `canPlay` defaults to true: most embeds always have a transport.
      disabled: ctx.canPlay === false,
      strong: true,
      onSelect: ctx.onTogglePlay,
    })
  }

  if (ctx.onStepBackward) {
    actions.push({
      id: 'step-backward',
      group: 'right',
      order: 10,
      icon: 'i-creatly-back-one-frame',
      label: label('step-backward'),
      title: title('step-backward'),
      disabled: ctx.canStep === false,
      onSelect: ctx.onStepBackward,
    })
  }

  if (ctx.onStepForward) {
    actions.push({
      id: 'step-forward',
      group: 'right',
      order: 20,
      icon: 'i-creatly-forward-one-frame',
      label: label('step-forward'),
      title: title('step-forward'),
      disabled: ctx.canStep === false,
      onSelect: ctx.onStepForward,
    })
  }

  if (ctx.onStepBackward || ctx.onStepForward)
    actions.push({ id: 'transport-divider', kind: 'divider', group: 'right', order: 30 })

  if (ctx.zoom !== false)
    actions.push({ id: 'zoom', kind: 'zoom', group: 'right', order: 100, slider: ctx.zoomSlider !== false })

  if (ctx.onToggleMute) {
    const muted = Boolean(ctx.muted)
    actions.push({
      id: 'mute',
      group: 'right',
      order: 110,
      icon: muted ? 'i-creatly-mute' : 'i-creatly-sound',
      label: label(muted ? 'unmute' : 'mute'),
      title: title(muted ? 'unmute' : 'mute'),
      onSelect: ctx.onToggleMute,
    })
  }

  return actions
}

/** Placement for an added action, relative to an existing one. */
export interface ToolbarActionPlacement {
  /** Insert directly before this action id. Wins over `after`. */
  before?: string
  /** Insert directly after this action id. */
  after?: string
}

export interface ToolbarActionPatch {
  /** Action ids to drop entirely. */
  remove?: string[]
  /** Shallow per-id overrides, e.g. `{ split: { disabled: true } }`. */
  override?: Record<string, Partial<ToolbarAction>>
  /** Actions to insert. Without a placement they are sorted by group/order. */
  add?: Array<ToolbarAction & ToolbarActionPlacement>
}

/**
 * Applies a patch to a base action list, in `remove` → `override` → `add`
 * order. Inserting with `before`/`after` copies the anchor's group and order so
 * the new action travels with it through the final sort; an unknown anchor
 * falls back to the action's own group/order rather than throwing, so a
 * consumer's toolbar does not disappear when a built-in is renamed upstream.
 */
export function mergeToolbarActions(base: ToolbarAction[], patch: ToolbarActionPatch = {}): ToolbarAction[] {
  const removed = new Set(patch.remove ?? [])
  let result: ToolbarAction[] = base
    .filter(action => !removed.has(action.id))
    .map((action) => {
      const override = patch.override?.[action.id]
      return override ? { ...action, ...override } as ToolbarAction : action
    })

  for (const entry of patch.add ?? []) {
    const { before, after, ...action } = entry
    const anchorId = before ?? after
    const anchor = anchorId ? result.find(item => item.id === anchorId) : undefined

    if (!anchor) {
      result = [...result, action as ToolbarAction]
      continue
    }

    const index = result.indexOf(anchor)
    const placed = {
      ...action,
      group: action.group ?? anchor.group,
      // Nudge off the anchor's slot so the stable sort keeps the requested
      // side even when other actions share the anchor's order.
      order: (anchor.order ?? 0) + (before ? -0.5 : 0.5),
    } as ToolbarAction
    result = [
      ...result.slice(0, before ? index : index + 1),
      placed,
      ...result.slice(before ? index : index + 1),
    ]
  }

  return result
}

/** Sorts a group's actions and drops dividers that no longer separate anything. */
export function resolveToolbarGroup(actions: ToolbarAction[], group: ToolbarActionGroup): ToolbarAction[] {
  const sorted = actions
    .filter(action => !action.hidden && (action.group ?? 'left') === group)
    .map((action, index) => ({ action, index }))
    .sort((a, b) => ((a.action.order ?? 0) - (b.action.order ?? 0)) || (a.index - b.index))
    .map(entry => entry.action)

  return sorted.filter((action, index) => {
    if (action.kind !== 'divider')
      return true
    // A divider earns its place only between two non-divider neighbours.
    const hasBefore = sorted.slice(0, index).some(item => item.kind !== 'divider')
    const hasAfter = sorted.slice(index + 1).some(item => item.kind !== 'divider')
    return hasBefore && hasAfter
  })
}
