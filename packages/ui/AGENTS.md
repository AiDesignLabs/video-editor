# @video-editor/ui

Vue 3 timeline components with advanced drag-and-drop for video editing.

## STRUCTURE

```
src/
├── VideoTimeline/           # Generic timeline layout engine
│   ├── index.vue            # Main component (~840 lines)
│   └── hooks/               # Interaction logic
│       ├── useDragAndDrop.ts
│       ├── useDragDetection.ts
│       └── useDragVisualFeedback.ts
├── VideoEditorTimeline/     # Protocol-aware wrapper
│   ├── index.vue            # Bridges protocol → timeline
│   └── segments/            # Custom segment renderers
│       ├── FramesSegment.vue
│       └── SegmentBase.vue
└── timeline/                # Atomic components
    ├── TimelineRoot.vue     # Viewport + scale provider
    ├── TimelineTracks.vue   # Track/segment layout
    ├── TimelineRuler.vue    # Time ticks
    └── TimelinePlayhead.vue # Scrubber
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Segment drag logic | `VideoTimeline/hooks/useDragAndDrop.ts` | Track targeting, gap detection |
| Y → track index | `VideoTimeline/hooks/useDragDetection.ts` | `resolveTrackIndexFromClientY()` |
| Snap guides | `VideoTimeline/hooks/useDragVisualFeedback.ts` | 100ms threshold |
| Zoom/scale | `VideoTimeline/index.vue` | `pixelsPerMs` stabilization |
| Protocol → UI | `VideoEditorTimeline/index.vue` | `applySegmentPosition()` |
| Thumbnail loading | `VideoEditorTimeline/segments/FramesSegment.vue` | ResizeObserver-based |

## COMPONENT LAYERS

1. **Editor Layer** (`VideoEditorTimeline/`) - Protocol-aware, provides segment slots
2. **Layout Layer** (`VideoTimeline/`) - Generic, manages scale + interactions
3. **Atomic Layer** (`timeline/`) - Stateless primitives

## CONVENTIONS

### Time-to-Pixel
`pixelsPerMs` is source of truth for horizontal layout:
```ts
width = duration * pixelsPerMs
left = startTime * pixelsPerMs
```

### Drag-Drop Visual Separation
- `mouseDeltaY` tracks raw pixel offset (smooth UX)
- Green placeholder shows actual drop position
- Blue line indicates new track creation

### Slot-Based Extensibility
Most content injected via scoped slots:
- `#segment` - Custom segment renderer
- `#toolbar` - Timeline toolbar
- `#ruler` - Custom ruler ticks

### CSS Variables
```css
--ve-segment-accent  /* Segment border color */
--ve-fps             /* Frames per second */
```

## ANTI-PATTERNS

| Forbidden | Reason |
|-----------|--------|
| Direct protocol mutation in UI | Use `emit('update:protocol', clone)` |
| Mixing visual/actual position | Keep `visualTrackIndex` vs `targetTrackIndex` separate |

## NOTES

- `VideoTimeline/index.vue` (~840 lines) is the complexity hotspot
- Segments can overlap on same track (by design)
- Empty tracks auto-deleted when last segment removed
- Snap-to-frame uses `1000 / fps` by default
- Thumbnails regenerate on resize via ResizeObserver
