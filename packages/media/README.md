# @video-editor/media

Media decode/encode abstraction for the video editor, currently implemented on
top of [mediabunny](https://mediabunny.dev) (WebCodecs).

## Why this package exists

`protocol` and `renderer` must not depend on a concrete third-party media
library. This package owns that dependency and exposes a small, stable
contract; swapping the underlying library only ever touches this package.

## Contract

- All timestamps on the public API are **milliseconds** (matching the video
  protocol). Conversion to the underlying seconds-based API happens inside.
- `openMediaInput(blob | url)` returns a `MediaInputHandle`:
  - `meta()` — duration/dimensions/audio info
  - `canDecodeVideo()` / `canDecodeAudio()` — WebCodecs support probe; callers
    must report an unsupported-media error when a required decoder is absent
  - `drawFrame(ctx, timeMs)` — decode one frame and draw it onto a canvas;
    frame lifecycle (`close()`) is handled internally
  - `thumbnails(width, { startMs, endMs, stepMs })`
  - `decodeAudioSlice(startMs, endMs)` — one `AudioBuffer` for WebAudio use
  - `dispose()`
- `createMp4Encoder({ canvas, ... })` returns a streaming fMP4 encoder driven
  by an external render loop: `addFrame(tMs, durMs)` captures the canvas,
  `setAudio(buffer)` encodes a mixed-down track, `stream` yields the file
  bytes.
- `renderCanvasToVideo({ canvas, durationMs, fps, renderFrame, sink })` drives
  an HTML or offscreen canvas with an exact media clock and writes MP4 or WebM
  bytes without buffering the whole file in memory.
- `captureCanvasStream({ canvas, frameRate })` returns a real-time
  `MediaStream`. HTML canvases use `captureStream()`; offscreen canvases use
  `VideoFrame` with a browser video-track generator. Missing browser features
  are reported before capture starts.
- `trimVideo({ source, startMs, endMs, sink })` trims the primary video and
  audio tracks into a streaming MP4 or WebM output. The result reports whether
  each track was copied or transcoded.
