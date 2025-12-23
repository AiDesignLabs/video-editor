# Video Editor Architecture

This document captures the agreed architecture for the video-editor monorepo. It reflects the current direction: a headless core built on a reactive protocol, with UI and rendering composed around it.

## Goals

- Provide a headless editor core that can be embedded in multiple apps.
- Keep renderer and UI optional and composable.
- Make plugins first-class while avoiding tight coupling between UI, protocol, and rendering.
- Preserve a clear upgrade path to third-party plugins later.

## Non-goals (for now)

- Third-party plugin sandbox/runtime.
- Remote plugin marketplace.
- Cross-app state synchronization beyond protocol snapshots.

## Layered Architecture

```
Protocol (shared + protocol)
  ↑
Editor Core (headless state/commands/selectors + plugin registry)
  ↑                 ↑
Renderer            UI Shell
  ↑                 ↑
Plugins (segment/ui/resource)
  ↑
Application (playground / product)
```

## Packages and Responsibilities

### `@video-editor/shared`

- Core TypeScript types (protocol, segments, tracks).
- Pure utilities (no reactive state, no DOM).
- Defines the single source of truth for protocol structure.

### `@video-editor/protocol`

- Reactive protocol state manager (undo/redo, validation, segment operations).
- Protocol parsing/verification.
- Resource manager (OPFS) and helpers (thumbnails, meta).

### `@video-editor/editor-core`

- Headless editor instance.
- Exposes:
  - `state` (read-only reactive view)
  - `commands` (all mutations)
  - `selectors` (read-only queries)
  - `plugins` (plugin lifecycle)
  - `registry` (segment plugin registry)
- No UI or renderer dependencies.

### `@video-editor/renderer`

- Rendering engine (Pixi-based).
- Accepts a reactive `protocol` ref and drives playback.
- No editor state mutation.

### `@video-editor/editor` (UI shell)

- Base UI layout and panels (future).
- Consumes `editor-core` and the UI components.
- Assembles the "default editor experience".

### `@video-editor/plugins`

- Built-in plugins (segments, panels, resources).
- Plugins depend on `editor-core`; UI plugins may also depend on `editor`.

### `playground`

- Demo/product assembly.
- Picks plugins, creates editor core, wires renderer + UI.

## Dependency Direction

- `shared` has no dependencies.
- `protocol` → `shared`
- `renderer` → `shared` (and optionally protocol types)
- `editor-core` → `protocol` + `shared`
- `editor` → `editor-core` + `ui`
- `plugins` → `editor-core` (UI plugins can also use `editor`)
- `playground` → `editor` + `plugins` + `renderer`

Critical rule: `editor-core` must NOT depend on `plugins` to avoid cycles.

## Data Flow

```
UI → editor-core.commands → protocol manager → reactive protocol
                                       ↓
                                  renderer (read-only)
```

All mutations go through `editor-core.commands`. Plugins should never mutate protocol directly.

## Editor Core API (minimum surface)

`editor-core` exposes a stable, minimal API so apps can embed it without UI:

```ts
const editor = createEditorCore({ protocol })

editor.state.protocol
editor.state.currentTime
editor.state.selectedSegment
editor.state.trackMap
editor.state.segmentMap
editor.state.duration
editor.state.undoCount
editor.state.redoCount

editor.commands.addSegment(...)
editor.commands.updateSegment(...)
editor.commands.removeSegment(...)
editor.commands.moveSegment(...)
editor.commands.resizeSegment(...)
editor.commands.addTransition(...)
editor.commands.removeTransition(...)
editor.commands.updateTransition(...)
editor.commands.undo()
editor.commands.redo()
editor.commands.exportProtocol()

editor.selectors.getSegment(...)
editor.selectors.getTrackById(...)
editor.selectors.getTrackBySegmentId(...)
editor.selectors.getTracks(...)
```

Design notes:
- `state` is read-only and reactive.
- `commands` are the only mutation entry point.
- `selectors` are convenience lookups; they do not mutate.

## Segment Plugin Model

Segment plugin is a capability bundle for a segment type.

For now (built-in segments):
- Schema lives in `protocol` only.
- Plugins provide:
  - ops (optional)
  - renderer adapter (optional)
  - UI bindings (optional)

Future (third-party segments):
- Plugin must provide its own schema + migration.

### Registry

`editor-core` provides a segment registry:
- `register(plugin)`
- `get(type)`
- `list()`

This is the lookup used by editor UI and renderer bridges.

## Plugin Lifecycle Order

The plugin lifecycle is intentionally minimal and synchronous by default:

1. **Register**: `editor.plugins.register(pluginCreator)`
   - The creator receives `EditorCoreContext`.
   - No side effects should assume other plugins are initialized yet.
2. **Init**: `editor.plugins.init()`
   - Calls `plugin.init()` for each registered plugin.
   - Plugins should wire UI bindings, commands, or effects here.
3. **Runtime**:
   - Plugins operate through editor-core commands/selectors.
   - Plugins must not mutate protocol directly.
4. **Destroy**: `editor.plugins.destroy()`
   - Calls `plugin.destroy()` for cleanup.

Notes:
- Registration order is preserved during init.
- Optional dependency ordering can be added later (not required now).
- Plugins should be idempotent: multiple init/destroy cycles should be safe.

### Segment Plugin Shape

```ts
{
  type: 'frames' | 'text' | 'audio' | ...,
  ops?: {
    create?(ctx, partial)
    update?(ctx, id, patch)
    remove?(ctx, id)
    split?(ctx, id, time)
  },
  renderer?: {
    toRenderNode(segment, ctx)
  },
  ui?: {
    panel?
    track?
    resource?
  }
}
```

For built-in segment types, the schema lives in `protocol`. Third-party segment types must provide schema and migration when introduced in the future.

## Renderer Integration

Renderer is composed at the app layer and receives the reactive protocol ref:

```ts
const editor = createEditorCore({ protocol })
const renderer = await createRenderer({ protocol: editor.state.protocol })
```

The renderer is read-only and should not mutate editor state.

## State Ownership and Synchronization

To avoid history resets and UI flicker:

- Treat `editor-core` as the single source of truth after it is created.
- Avoid re-creating `editor-core` on every protocol update.
- External updates should be applied with intent:
  - Soft update: only apply if protocol has truly changed.
  - Force update: reserved for switching projects or hard rehydration.

Guideline:
- Local edits go through `commands`.
- Server sync should not replace the protocol unless the user explicitly reloads or switches context.

## Presets and Composition

Provide presets so apps can quickly assemble common stacks:

- `preset-full`: editor + renderer + full plugin set.
- `preset-viewer`: renderer + timeline UI + minimal plugins.
- `preset-data`: protocol + editor-core only.

Presets should live outside `editor-core` to keep it stable and small.

## UI Strategy

Two layers:

1. **Headless core** (`editor-core`) for logic and data.
2. **UI shell** (`editor`) for layout and panels.

The UI layer is optional. Apps that only need protocol preview or a timeline can skip it and use core + renderer + specific UI components.

## Usage Profiles

### Full editor (playground / product)

- `editor-core` + `editor` + `plugins` + `renderer`
- Build a CapCut/Jianying-like experience.

### Preview-only

- `editor-core` + `renderer` + `ui/VideoEditorTimeline`
- Minimal UI for timeline + playback.

### Data-only

- `protocol` + `editor-core`
- Protocol manipulation, validation, and export without rendering.

## Integration Recipes

### Preview-only (renderer + timeline)

```ts
const editor = createEditorCore({ protocol })
const renderer = await createRenderer({ protocol: editor.state.protocol })
```

Bind `editor.state.currentTime` to the timeline playhead and call `editor.commands` for edits.

### Full editor (UI shell + plugins)

```ts
const editor = createEditorCore({ protocol })
registerDefaultPlugins(editor)
mountEditorUi(editor)
createRenderer({ protocol: editor.state.protocol })
```

## Key Design Decisions

- **Headless core** is required for reuse across products.
- **Renderer remains separate** to avoid DOM/Pixi in the core.
- **Protocol is the source of truth**; editor-core is the command gate.
- **Plugins are composable**, but core stays stable and minimal.

## Future Extensions

- Third-party plugins with schema/migration.
- Plugin permissioning and sandboxing.
- Prebuilt presets for different app shapes.
