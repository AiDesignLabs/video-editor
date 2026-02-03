# @video-editor/ui

Vue 3 timeline components for video editor with drag-and-drop support.

## Features

- 📹 **VideoTimeline** - Basic timeline with playhead and zoom
- ✂️ **VideoEditorTimeline** - Full-featured editor timeline
- 🎬 **FramesSegment** - Video/image segment with thumbnails
- 🎵 **AudioSegment** - Audio segment with waveform visualization
- 🎨 **Rich Slot System** - Extensive customization via Vue slots
- 📱 **Responsive** - Adapts to container size changes

## Installation

```bash
pnpm add @video-editor/ui
```

## Quick Start

```vue
<script setup lang="ts">
import { VideoEditorTimeline } from '@video-editor/ui'
import type { IVideoProtocol } from '@video-editor/shared'

const protocol: IVideoProtocol = {
  // Your protocol data
}
</script>

<template>
  <VideoEditorTimeline :protocol="protocol" />
</template>
```

## Components

### VideoEditorTimeline

Full-featured timeline component with segment rendering, drag-and-drop, and zoom controls.

### VideoTimeline

Simplified timeline component for basic playback and visualization.

### Segment Components

All segment components support extensive customization via slots:

#### FramesSegment

Slots: `image`, `video`, `loading`, `error`, `empty`, `fallback`, `overlay`

#### AudioSegment

Slots: `waveform`, `loading`, `error`, `empty`, `overlay`

See [AudioSegment Slots Documentation](./docs/AudioSegment-slots.md) for detailed examples.

## Customization Examples

### Custom Audio Waveform

```vue
<AudioSegment :segment="audioSegment">
  <template #waveform="{ peaks, coveragePercent }">
    <svg :style="{ width: `${coveragePercent}%` }">
      <!-- Custom SVG rendering -->
    </svg>
  </template>

  <template #overlay="{ segment }">
    <span class="badge">{{ segment.extra?.label }}</span>
  </template>
</AudioSegment>
```

### Custom Video Segment

```vue
<FramesSegment :segment="videoSegment">
  <template #video="{ thumbnails }">
    <!-- Custom thumbnail display -->
  </template>

  <template #loading>
    <CustomSpinner />
  </template>
</FramesSegment>
```

## Styling

The UI package uses CSS variables for theming:

```css
:root {
  --ve-segment-accent: #0ea5e9; /* Segment accent color */
}
```

## Documentation

- [AudioSegment Slots](./docs/AudioSegment-slots.md) - Complete slot API reference

## Dependencies

- Vue 3.x
- @video-editor/shared (types)
- @video-editor/protocol (waveform extraction)
