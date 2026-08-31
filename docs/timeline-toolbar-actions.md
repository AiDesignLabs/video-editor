# Timeline toolbar actions

`@video-editor/ui`'s timeline toolbar is driven by a list of plain action
descriptors. The package owns the standard controls; an embedding app adds,
removes, reorders or re-renders them without reimplementing the toolbar.

## Why not slots alone

The toolbar used to be slots only (`toolbar-left`, `toolbar-center`, …). A
consumer who wanted one extra button had to take over a whole zone, hand-write
the built-ins beside it, and then drift from upstream every time the standard
set changed. `playground/src/App.vue` and creatly's `VideoTracks.vue` had each
grown their own near-identical copy of the same nine buttons.

## The model

```ts
import { createDefaultToolbarActions, mergeToolbarActions } from '@video-editor/ui'

const actions = computed(() => mergeToolbarActions(
  createDefaultToolbarActions({
    onAdd: openAssets,
    onDelete: removeSelected,
    onSplit: splitAtPlayhead,
    onUndo: commands.undo,
    onRedo: commands.redo,
    onTogglePlay: togglePlay,
    onStepBackward: () => stepFrame(-1),
    onStepForward: () => stepFrame(1),
    onToggleMute: toggleMasterMute,
    hasSelection: Boolean(selectedSegmentId.value),
    canUndo: Boolean(undoCount.value),
    canRedo: Boolean(redoCount.value),
    isPlaying: isPlaying.value,
    muted: muted.value,
  }),
  {
    add: [{ id: 'saved', kind: 'status', icon: 'i-creatly-save', text: label.value, after: 'redo' }],
  },
))
```

```vue
<VideoEditorTimeline :toolbar-actions="actions" />
```

**Every handler is optional.** An action whose handler is missing is not
emitted, which is how an embed opts out of a capability it cannot support —
creatly's preview workspace has no `onSplit`, so no split button appears.
Dividers between the built-in clusters collapse automatically once optional
actions drop out, so callers never reason about them.

### Action kinds

| `kind`             | Renders                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `button` (default) | `<button class="ve-btn">` with `icon`, `label`, `title`, `disabled`, `active`, `strong` |
| `divider`          | A hairline; dropped when it no longer separates two things                              |
| `status`           | Non-interactive text with an optional leading icon                                      |
| `zoom`             | The built-in zoom cluster (out / slider / in)                                           |
| `slot`             | Nothing — reserves the position for the host's `action-<id>` slot                       |

`group` is `left` / `center` / `right`; `order` sorts within a group. Built-ins
are spaced by 10 so an extra action slots between two of them.

### Reshaping the standard set

`mergeToolbarActions(base, patch)` applies `remove` → `override` → `add`.
Additions position themselves with `before` / `after` an existing id, inheriting
that anchor's group and order; an unknown anchor appends rather than throwing,
so a consumer's toolbar survives a built-in being renamed upstream.

## Three escape hatches, narrowest first

1. **`#action-<id>`** — render one action yourself. Use it for `kind: 'slot'`
   placeholders (creatly's save cluster and its own zoom slider) or to override
   a single built-in.
2. **`#toolbar-button`** — render _every_ button action yourself, receiving
   `{ action }`. This is how a host keeps its own button component and tooltips
   while still sharing the action list. creatly's `VideoTracks.vue` renders a
   PrimeVue `Button` with `v-tooltip` this way.
3. **`#toolbar-left` / `-center` / `-right` / `-right-leading` /
   `-right-trailing` / `#toolbar`** — the original zone slots. Still supported
   and still win over the action list, so nothing that predates this model
   broke. Prefer 1 or 2.

## Keeping the host's button component

`#toolbar-button` hands you `{ action }` and takes over rendering for every
button. If all you need is to decorate the package's own button — a tooltip
directive from your component library, say — import it rather than rebuilding
it. `TimelineToolbarButton` is single-rooted, so directives and attributes land
on the real `<button>`:

```vue
<VideoEditorTimeline :toolbar-actions="actions">
  <template #toolbar-button="{ action }">
    <TimelineToolbarButton v-tooltip.top="action.title ?? action.label" :action="action" />
  </template>
</VideoEditorTimeline>
```

## Styling

Toolbar chrome reads `--ve-*` tokens from `theme.css`; `.ve-btn`,
`.ve-toolbar-divider` and `.ve-toolbar-status` are deliberately global so
slotted content can use them. See [`timeline-design-spec.md`](./timeline-design-spec.md).

`@video-editor/ui/style.css` is self-contained: it bundles the `i-creatly-*`
icons the default actions reference, with presetWind4's reset switched off so
the package never restyles its host. A host that only uses the standard actions
needs no icon setup of its own.

### Light and dark

Every colour token is written once with `light-dark()`, so the theme follows the
**computed `color-scheme`**, not a class. `theme.css` sets it from `:root` (the
OS), `html.dark` / `html.light` (the Tailwind and @nuxtjs/color-mode
convention), `[data-theme]`, and `.ve-theme-dark` / `.ve-theme-light` for
theming a subtree without touching the document.

If your app flips themes with a class and never sets `color-scheme` — which is
the default for both of those libraries — set it alongside the class:

```css
:root {
  color-scheme: light;
}
html.dark {
  color-scheme: dark;
}
```

Without it the timeline renders in the OS theme while the rest of the page is
dark. `src/theme.test.ts` guards the hook list and fails on any colour token
that is not declared for both themes.
