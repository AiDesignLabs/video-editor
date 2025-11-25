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
