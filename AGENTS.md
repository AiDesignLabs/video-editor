# VIDEO EDITOR KNOWLEDGE BASE

**Generated:** 2026-01-23
**Commit:** d6d7791
**Branch:** main

## OVERVIEW

CapCut-inspired video editor monorepo. Headless core architecture with reactive protocol state, Pixi.js rendering, Vue 3 UI. pnpm workspaces + Vite.

## STRUCTURE

```
video-editor/
├── packages/
│   ├── shared/        # Types only (IVideoProtocol, segments, tracks)
│   ├── protocol/      # State manager + OPFS resources + Ajv validation
│   ├── editor-core/   # Headless commands/selectors/plugins API
│   ├── renderer/      # Pixi.js rendering engine
│   ├── ui/            # Vue timeline components + drag-drop hooks
│   ├── editor/        # [placeholder] UI shell
│   └── plugins/       # [placeholder] Built-in plugins
├── playground/        # Demo app (root-level, not in /apps)
├── scripts/           # Git hooks, reactivity check
└── types/             # Global d.ts (mp4box)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Protocol types | `packages/shared/src/protocol.ts` | All segment/track interfaces |
| Add segment | `packages/protocol/src/manage/index.ts` | `addSegment()`, `removeSegment()` |
| Undo/redo | `packages/protocol/src/manage/immer.ts` | Patch-based history |
| Validation rules | `packages/protocol/src/verify/rules/` | Ajv JSON schemas |
| Resource storage | `packages/protocol/src/resource/` | OPFS via opfs-tools |
| Video thumbnails | `packages/protocol/src/resource/thumbnails.ts` | Frame extraction |
| Headless editor API | `packages/editor-core/src/core.ts` | `createEditorCore()` |
| Timeline drag-drop | `packages/ui/src/VideoTimeline/hooks/` | 3 specialized hooks |
| Pixi rendering | `packages/renderer/src/renderer-core.ts` | ~860 lines, main hotspot |
| Demo integration | `playground/src/App.vue` | Full stack example |

## ARCHITECTURE

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

**Data Flow:** UI → editor-core.commands → protocol manager → reactive protocol → renderer (read-only)

**Critical Rule:** Never mutate protocol directly. Always use `editor-core.commands`.

## CONVENTIONS

### pnpm Catalogs
Dependency versions centralized in `pnpm-workspace.yaml` using `catalog:` protocol. Add new deps there, not in package.json.

### Reactivity Singleton
`@vue/reactivity` must be single instance. Packages declare it as peerDependency. Verified by `scripts/check-reactivity.mjs`.

### Commit Format
```
<type>(<scope>): <subject>
```
Types: feat, fix, docs, dx, style, refactor, perf, test, workflow, build, ci, chore, types, wip, release

### Code Style
- English comments only
- Vue 3 Composition API with `<script setup lang="ts">`
- `defineOptions({ name: 'ComponentName' })`
- Strict TypeScript (no `as any`, `@ts-ignore`)

### Testing
- Vitest workspace across packages
- `*.test.ts` = Node environment
- `*.browser.test.ts` = Playwright/Chromium (OPFS, Canvas)
- Protocol package has extensive coverage; others sparse

## ANTI-PATTERNS

| Forbidden | Reason |
|-----------|--------|
| Direct protocol mutation | Bypasses history, breaks reactivity |
| Multiple `@vue/reactivity` instances | Dead reactive objects |
| Mutations in selectors | Selectors are read-only queries |
| `editor-core` depending on `plugins` | Cyclic dependency |
| Gaps in main frames track | Must be continuous timeline |
| Multiple `isMain` frames tracks | Only one allowed |
| `npm` or `yarn` | pnpm-only (preinstall hook) |

## COMMANDS

```bash
pnpm install              # Setup (pnpm enforced)
pnpm dev                  # Playground dev server
pnpm build                # Build all packages
pnpm check                # TypeScript check
pnpm test                 # All tests
pnpm test:protocol        # Protocol tests with UI
pnpm lint:fix             # ESLint auto-fix
pnpm check:reactivity     # Verify single reactivity instance
```

## COMPLEXITY HOTSPOTS

| File | Lines | Concern |
|------|-------|---------|
| `protocol/src/manage/index.ts` | ~980 | Timeline rebuild, undo/redo |
| `renderer/src/renderer-core.ts` | ~860 | Pixi stage, video sync |
| `ui/src/VideoTimeline/index.vue` | ~840 | Zoom, coordinate mapping |

## NOTES

- `packages/editor` and `packages/plugins` are placeholders (console.log only)
- `editor-core` is fully implemented but omitted from some docs
- `packages/devtools` contains only reactivity check binary
- README files in packages have incorrect headers (copy-paste artifact)
- Main frames track enforces "no gaps" via automatic segment shifting
- OPFS used for browser-local resource caching (offline-first)
