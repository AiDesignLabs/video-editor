# @video-editor/renderer

Pixi.js-based video rendering engine. Translates protocol JSON into visual frames.

## STRUCTURE

```
src/
├── renderer-core.ts    # Main renderer (~860 lines, hotspot)
├── compose.ts          # Video composition/export
├── concat.ts           # Multi-clip concatenation
├── protocol-clip.ts    # Protocol → clip conversion
├── layout.ts           # Canvas layout calculations
├── text.ts             # Text segment rendering
├── helpers.ts          # Utility functions
├── 2d/                 # 2D rendering helpers
└── index.ts            # Package exports
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Create renderer | `renderer-core.ts` | `createRenderer()` factory |
| Frame sync | `renderer-core.ts` | `renderScene()`, `updateVideoFrame()` |
| Video export | `compose.ts` | Final video composition |
| Clip merging | `concat.ts` | Multi-segment concatenation |
| Canvas sizing | `layout.ts` | Responsive layout logic |
| Text rendering | `text.ts` | Text segment → Pixi |

## KEY CONCEPTS

### Video Sources
Dual-source strategy:
- **MP4Clip** (WebAV): High-performance for supported formats
- **HTMLVideoElement**: Fallback for broader compatibility

### Protocol Binding
Renderer accepts reactive `protocol` ref:
```ts
const renderer = await createRenderer({ 
  protocol: editor.state.protocol 
})
```
Renderer is **read-only** - never mutates protocol.

### Frame Synchronization
`renderScene` ensures canvas frame matches `currentTime`:
- Handles drift between UI clock and video playback
- Critical for accurate scrubbing and export

## CONVENTIONS

### Read-Only Pattern
Renderer subscribes to protocol changes but never writes back. All edits flow through `editor-core.commands`.

### Reactivity
Declares `@vue/reactivity` as peer dependency. Must share instance with protocol/editor-core.

## ANTI-PATTERNS

| Forbidden | Reason |
|-----------|--------|
| Protocol mutation | Renderer is read-only consumer |
| Bundling reactivity | Must be peer dependency |
| Blocking frame updates | Keep `renderScene` non-blocking |

## NOTES

- `renderer-core.ts` (~860 lines) is the complexity hotspot
- Audio segments have no visual representation yet (waveforms TODO)
- Consider splitting video source handlers into strategy modules
- WebAV provides better performance than HTMLVideoElement when available
