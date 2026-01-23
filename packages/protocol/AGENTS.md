# @video-editor/protocol

Core state management, validation, and resource handling for the video editor.

## STRUCTURE

```
src/
├── manage/         # Reactive state + undo/redo
├── verify/         # Ajv JSON Schema validation
├── resource/       # OPFS storage + media utilities
├── parse/          # Protocol serialization (thin wrapper)
└── index.ts        # Package exports
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add/remove segments | `manage/index.ts` | `addSegment()`, `removeSegment()`, `updateSegment()` |
| Undo/redo system | `manage/immer.ts` | Patch-based history via Immer |
| Timeline rebuild | `manage/index.ts` | `rebuildTrackTimeline()` - main track vs overlay logic |
| Segment validation | `verify/rules/*.ts` | Per-type JSON schemas |
| Full protocol verify | `verify/index.ts` | `createValidator().verify()` |
| OPFS resource CRUD | `resource/index.ts` | `createResourceManager()` |
| Video metadata | `resource/meta.ts` | `getMp4Meta()` via mp4box.js |
| Thumbnail extraction | `resource/thumbnails.ts` | Frame snapshots for timeline |
| Remote fetch → OPFS | `resource/fetch.ts` | Stream resources to local storage |

## KEY EXPORTS

| Export | Description |
|--------|-------------|
| `createVideoProtocolManager` | Factory for reactive protocol state |
| `createResourceManager` | Factory for OPFS resource handling |
| `createValidator` | Factory for Ajv validation |
| `getMp4Meta` | Extract video file properties |
| `parse` | JSON → protocol object |

## CONVENTIONS

### Timeline Rules
- **Main frames track**: No gaps allowed. Segments auto-shift to maintain continuity.
- **Overlay tracks**: Gaps allowed, but no overlaps.
- **Transitions**: Only between adjacent segments on main track.

### Validation
- IDs must be unique across all tracks and segments
- `startTime < endTime` enforced
- Type-specific rules in `verify/rules/` (volume 0-100, valid transforms, etc.)

### State Management
- Vue `@vue/reactivity` for deep reactivity
- Immer patches for history (undo captures inverse patch)
- Failed validation auto-rollbacks via inverse patch

## ANTI-PATTERNS

| Forbidden | Reason |
|-----------|--------|
| Direct state mutation | Bypasses history tracking |
| Multiple `isMain` tracks | Protocol constraint |
| Gaps in main track | `rebuildTrackTimeline` enforces continuity |
| Bundling `@vue/reactivity` | Must be peer dependency |

## TESTING

```bash
pnpm -C packages/protocol test        # Headless
pnpm -C packages/protocol test:ui     # Browser (Playwright)
```

Tests use `*.browser.test.ts` suffix for OPFS/Canvas tests requiring real browser.

## NOTES

- `manage/index.ts` (~980 lines) is the complexity hotspot
- `get-obj-path-value.ts` has optimization TODO for type checking
- Resource manager lacks full audio/subtitle support
- No "breakpoint continue" for large OPFS saves yet
