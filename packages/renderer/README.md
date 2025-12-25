# @video-editor/renderer

Reactive renderer that consumes an `IVideoProtocol` and drives a Pixi scene like a lightweight video player.

```ts
import { createRenderer } from '@video-editor/renderer'
import { reactive } from '@vue/reactivity'

const protocol = reactive({
  version: '1.0.0',
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
})

const renderer = await createRenderer({ protocol, autoPlay: true })

// drive the player
renderer.play()
renderer.seek(1000)
renderer.tick(16.7) // or rely on requestAnimationFrame loop

// mutate protocol reactively; the renderer will verify and update visuals
protocol.tracks.push(/* ... */)
```

## Video composition

```ts
import { composeProtocol } from '@video-editor/renderer'

const { stream, durationMs } = await composeProtocol(protocol, {
  onProgress: (progress) => console.log('progress', progress),
})

const blob = await new Response(stream).blob()
console.log('duration (ms)', durationMs, blob)
```

## Concatenate videos

```ts
import { concatVideos } from '@video-editor/renderer'

const { stream, durationMs } = await concatVideos(
  [
    'https://example.com/intro.mp4',
    'https://example.com/main.mp4',
  ],
  {
    onProgress: (progress) => console.log('progress', progress),
  },
)

const blob = await new Response(stream).blob()
console.log('duration (ms)', durationMs, blob)
```
