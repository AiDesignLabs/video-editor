# @video-editor/protocol

Video editor protocol management, validation, and resource utilities.

## Features

- **Protocol Management**: Create and manage video editor protocols with undo/redo
- **Validation**: JSON Schema validation for all segment types
- **Resource Management**: OPFS-based caching for video/audio resources
- **Waveform Extraction**: Extract and cache audio waveforms for visualization
- **Thumbnail Generation**: Extract video thumbnails with caching

## Installation

```bash
pnpm add @video-editor/protocol
```

## Quick Start

### Managed Media

```typescript
import { createMediaAssetCatalog } from '@video-editor/protocol'

const assets = createMediaAssetCatalog({
  getProtectedProtocols: () => [editor.commands.exportProtocol()],
})

const asset = await assets.import(file)
const binding = await assets.bindForSegment(asset.id)

if (asset.kind === 'video') {
  const controller = new AbortController()
  await assets.generatePreviewVersion(asset.id, {
    signal: controller.signal,
    onProgress: ({ ratio }) => console.log(`Preview: ${Math.round(ratio * 100)}%`),
  })
  await renderer.refreshAssets()
}
```

Use `MediaAssetCatalog` in application code. It hides OPFS files, proxy records, revisions, and changing
resource URLs. `AssetLibrary` is an internal implementation used by storage, proxy generation, and diagnostics;
it is not exported from the package entry.

Pass `assets.resolveForPreview` to the renderer and `assets.resolveForExport` to compose. Preview video frames
use the current generated preview version, while video audio and exports keep using the original source.

### Audio Waveform Extraction

```typescript
import { extractWaveform, peaksToSvgPath } from '@video-editor/protocol'

// Extract waveform from audio URL
const waveform = await extractWaveform('/audio.mp3', { samples: 1000 })

// Generate SVG path for rendering
const svgPath = peaksToSvgPath(waveform.peaks, 800, 100)

console.log(waveform.peaks) // number[] - normalized 0-1
console.log(waveform.duration) // number - seconds
```

### Protocol Management

```typescript
import type { IVideoProtocol } from '@video-editor/protocol'
import { createVideoProtocolManager } from '@video-editor/protocol'

const protocol: IVideoProtocol = { /* ... */ }
const manager = createVideoProtocolManager(protocol)

// Add segment
manager.addSegment({
  id: 'audio-1',
  segmentType: 'audio',
  url: '/audio.mp3',
  startTime: 0,
  endTime: 3000,
})

// Undo/Redo
manager.undo()
manager.redo()
```

### Resource Caching

```typescript
import { createResourceManager } from '@video-editor/protocol'

const resourceManager = createResourceManager()

// Add resource to OPFS cache
await resourceManager.add('/video-editor-res/audio.mp3', audioBlob)

// Read from cache
const cached = await resourceManager.read('/video-editor-res/audio.mp3')
```

## Documentation

See [WAVEFORM.md](../../WAVEFORM.md) for detailed waveform API documentation.

## Exports

### Waveform

- `extractWaveform(url, options)` - Extract waveform from URL
- `extractWaveformFromBuffer(buffer, cacheKey, options)` - Extract from ArrayBuffer
- `clearWaveformCache(url?)` - Clear waveform cache
- `peaksToSvgPath(peaks, width, height)` - Generate SVG path
- `peaksToBars(peaks, width)` - Generate bar data

### Protocol

- `createVideoProtocolManager(protocol)` - Create protocol manager
- `createValidator()` - Create protocol validator
- `parse(protocolString)` - Parse and validate protocol JSON

### Resources

- `createResourceManager(dir?)` - Create resource manager
- `generateThumbnails(url, options)` - Generate video thumbnails
- `getMp4Meta(url)` - Extract MP4 metadata
