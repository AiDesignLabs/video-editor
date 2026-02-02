# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CapCut-inspired video editor built as a monorepo with headless core architecture. Features reactive protocol state management, Pixi.js rendering, and Vue 3 UI components.

## Essential Commands

### Development
```bash
pnpm dev                 # Start playground dev server
pnpm build               # Build all packages
pnpm check               # TypeScript type check (no emit)
pnpm check:reactivity    # Verify single @vue/reactivity instance
```

### Testing
```bash
pnpm test                # Run all tests
pnpm test:protocol       # Protocol tests with Vitest UI
pnpm -C packages/protocol test        # Protocol tests headless
pnpm -C packages/protocol test:ui     # Protocol tests with UI
```

### Code Quality
```bash
pnpm lint                # ESLint with cache
pnpm lint:fix            # Auto-fix linting issues
```

### Working with Individual Packages
```bash
pnpm -C packages/<package> <command>   # Run command in specific package
pnpm -F <package> <command>            # Alternative filter syntax
```

## Architecture

### Package Structure
```
video-editor/
├── packages/
│   ├── shared/        # TypeScript types only (IVideoProtocol, segments, tracks)
│   ├── protocol/      # Reactive state manager + OPFS resources + Ajv validation
│   ├── editor-core/   # Headless commands/selectors/plugins API
│   ├── renderer/      # Pixi.js rendering engine
│   ├── ui/            # Vue 3 timeline components + drag-drop hooks
│   ├── editor/        # [placeholder] UI shell
│   ├── plugins/       # [placeholder] Built-in plugins
│   └── devtools/      # Reactivity check utility
├── playground/        # Demo app (root-level)
├── scripts/           # Git hooks, reactivity verification
└── types/             # Global TypeScript definitions (mp4box)
```

### Dependency Flow
```
Protocol (shared + protocol)
  ↑
Editor Core (commands/selectors/plugins)
  ↑                 ↑
Renderer            UI Shell
  ↑                 ↑
Plugins
  ↑
Application (playground)
```

**Critical Rule:** Never mutate protocol directly. Always use `editor-core.commands`.

### Data Flow
```
UI → editor-core.commands → protocol manager → reactive protocol → renderer (read-only)
```

## Key Locations

| Task | Location | Notes |
|------|----------|-------|
| Protocol types | `packages/shared/src/protocol.ts` | All segment/track interfaces |
| State management | `packages/protocol/src/manage/index.ts` | `addSegment()`, `removeSegment()`, undo/redo |
| Undo/redo system | `packages/protocol/src/manage/immer.ts` | Patch-based history |
| Validation rules | `packages/protocol/src/verify/rules/` | Ajv JSON schemas per segment type |
| OPFS resources | `packages/protocol/src/resource/` | Browser-local file storage |
| Headless editor API | `packages/editor-core/src/core.ts` | `createEditorCore()` |
| Timeline drag-drop | `packages/ui/src/VideoTimeline/hooks/` | 3 specialized composables |
| Pixi rendering | `packages/renderer/src/renderer-core.ts` | ~860 lines, main hotspot |
| Demo integration | `playground/src/App.vue` | Full stack example |

## Critical Conventions

### pnpm Catalog Dependencies
Dependency versions are centralized in `pnpm-workspace.yaml` using the `catalog:` protocol. When adding new dependencies:
- Add version to `catalog:` section in `pnpm-workspace.yaml`
- Reference as `"dependency": "catalog:"` in package.json

### Reactivity Singleton Requirement
`@vue/reactivity` must be a single instance across all packages:
- Packages declare it as **peerDependency** (not dependency)
- Verified by `pnpm check:reactivity` script
- Multiple instances cause dead reactive objects

### Timeline Architecture Rules
- **Main frames track**: No gaps allowed. Segments auto-shift to maintain continuity via `rebuildTrackTimeline()`
- **Overlay tracks**: Gaps allowed, but no overlaps
- **Transitions**: Only between adjacent segments on main track
- Only one `isMain` frames track permitted

### Commit Message Format
Enforced by git hook (`scripts/verifyCommit.mjs`):
```
<type>(<scope>): <subject>
```
Types: `feat`, `fix`, `docs`, `dx`, `style`, `refactor`, `perf`, `test`, `workflow`, `build`, `ci`, `chore`, `types`, `wip`, `release`

### Code Style
- English comments only
- Vue 3 Composition API with `<script setup lang="ts">`
- Use `defineOptions({ name: 'ComponentName' })` for component names
- Strict TypeScript - no `as any` or `@ts-ignore`

### Testing Conventions
- `*.test.ts` = Node environment (Vitest)
- `*.browser.test.ts` = Playwright/Chromium (for OPFS, Canvas tests)
- Protocol package has extensive coverage; other packages sparse

## Anti-Patterns to Avoid

| Forbidden | Reason |
|-----------|--------|
| Direct protocol mutation | Bypasses history tracking, breaks undo/redo |
| Multiple `@vue/reactivity` instances | Creates dead reactive objects |
| Mutations in selectors | Selectors are read-only queries |
| `editor-core` depending on `plugins` | Creates cyclic dependency |
| Gaps in main frames track | Violates timeline continuity requirement |
| Multiple `isMain` frames tracks | Protocol constraint - only one allowed |
| Using `npm` or `yarn` | pnpm enforced via preinstall hook |

## Complexity Hotspots

These files are large and complex - read carefully before modifying:

| File | Lines | Key Concerns |
|------|-------|--------------|
| `packages/protocol/src/manage/index.ts` | ~980 | Timeline rebuild logic, undo/redo state |
| `packages/renderer/src/renderer-core.ts` | ~860 | Pixi stage management, video frame sync |
| `packages/ui/src/VideoTimeline/index.vue` | ~840 | Zoom handling, coordinate transformation |

## Editor Core API

The headless editor provides a minimal, stable API:

### State (read-only, reactive)
- `editor.state.protocol` - Full protocol object
- `editor.state.currentTime` - Playhead position
- `editor.state.selectedSegment` - Currently selected segment
- `editor.state.duration` - Total timeline duration
- `editor.state.undoCount` / `redoCount` - History stack sizes

### Commands (mutation entry point)
- `editor.commands.addSegment(segment)` - Add segment at current time
- `editor.commands.updateSegment(id, partial)` - Update segment properties
- `editor.commands.removeSegment(id)` - Remove segment
- `editor.commands.moveSegment(id, trackId, startTime)` - Move segment
- `editor.commands.resizeSegment(id, { startTime?, endTime? })` - Resize segment
- `editor.commands.undo()` / `redo()` - History navigation
- `editor.commands.exportProtocol()` - Get protocol JSON

### Selectors (read-only queries)
- `editor.selectors.getSegment(id)` - Get segment by ID
- `editor.selectors.getTrackById(id)` - Get track by ID
- `editor.selectors.getTrackBySegmentId(id)` - Find parent track of segment

## Drag-Drop System (VideoTimeline)

The drag-drop logic is split across three composables in `packages/ui/src/VideoTimeline/hooks/`:

1. **`useDragDetection.ts`** - Position/track detection
   - `detectTrackGap()` - Detect mouse in gap between tracks
   - `resolveTrackIndexFromClientY()` - Convert Y position to track index

2. **`useDragVisualFeedback.ts`** - Visual feedback
   - `snapGuides` - Show alignment guides (100ms threshold)
   - Green placeholder = actual drop position
   - Blue line = new track creation

3. **`useDragAndDrop.ts`** - Main coordination
   - Track type compatibility rules
   - Separates visual position (follows mouse) vs actual placement
   - Emits `SegmentDragPayload` with placement data

## OPFS Resource Management

Protocol package uses Origin Private File System for browser-local storage:
- Default directory: `/video-editor-res`
- `createResourceManager()` provides CRUD operations
- `getMp4Meta()` extracts video metadata via mp4box.js
- Thumbnail extraction in `resource/thumbnails.ts`

## Important Notes

- `packages/editor` and `packages/plugins` are placeholder packages (console.log only)
- `editor-core` is fully implemented but may be missing from some docs
- README files in packages have incorrect headers (copy-paste artifact)
- OPFS resources are cached offline-first for better performance
- Path aliases: `@video-editor/*` maps to `packages/*/src/index.ts`

## Git Hooks

- **pre-commit**: Runs lint-staged (ESLint auto-fix)
- **commit-msg**: Validates commit message format
- **pre-push**: Runs all tests (`pnpm test`)
