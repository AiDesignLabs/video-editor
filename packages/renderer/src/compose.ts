import type { IVideoProtocol } from '@video-editor/shared'
import type { ICombinatorOpts } from '@webav/av-cliper'
import { Combinator, OffscreenSprite } from '@webav/av-cliper'
import { ProtocolVideoClip } from './protocol-clip'
import type { ProtocolVideoClipOptions } from './protocol-clip'

export interface ComposeProtocolOptions extends Omit<ICombinatorOpts, 'width' | 'height' | 'fps'> {
  width?: number
  height?: number
  fps?: number
  onProgress?: (progress: number) => void
  clipOptions?: ProtocolVideoClipOptions
  audioSprites?: (protocol: IVideoProtocol) => Promise<OffscreenSprite[]>
}

export interface ComposeProtocolResult {
  stream: ReadableStream<Uint8Array>
  width: number
  height: number
  durationMs: number
  destroy: () => void
}

function wrapStreamWithCleanup(
  stream: ReadableStream<Uint8Array>,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  let cleaned = false
  const finalize = () => {
    if (cleaned)
      return
    cleaned = true
    cleanup()
  }

  const reader = stream.getReader()
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        finalize()
        controller.close()
        return
      }
      controller.enqueue(value)
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      }
      finally {
        finalize()
      }
    },
  })
}

export async function composeProtocol(
  protocol: IVideoProtocol,
  opts: ComposeProtocolOptions = {},
): Promise<ComposeProtocolResult> {
  const {
    width: requestedWidth,
    height: requestedHeight,
    fps: requestedFps,
    onProgress,
    clipOptions,
    audioSprites,
    ...combinatorOpts
  } = opts

  const width = requestedWidth ?? protocol.width
  const height = requestedHeight ?? protocol.height
  if (!width || !height)
    throw new Error('composeProtocol: output width/height is required')

  const fps = requestedFps ?? protocol.fps

  const combinator = new Combinator({
    ...combinatorOpts,
    width,
    height,
    fps,
  })

  if (onProgress)
    combinator.on('OutputProgress', onProgress)

  let clip: ProtocolVideoClip | undefined
  try {
    clip = new ProtocolVideoClip(protocol, {
      width,
      height,
      fps,
      ...clipOptions,
    })
    await clip.ready

    const sprite = new OffscreenSprite(clip)
    await sprite.ready
    sprite.time.offset = 0
    sprite.time.duration = clip.meta.duration
    sprite.rect.x = 0
    sprite.rect.y = 0
    sprite.rect.w = clip.meta.width
    sprite.rect.h = clip.meta.height

    await combinator.addSprite(sprite, { main: true })
    sprite.destroy()

    if (audioSprites) {
      const sprites = await audioSprites(protocol)
      for (const extra of sprites)
        await combinator.addSprite(extra)
    }
  }
  catch (err) {
    combinator.destroy()
    throw err
  }

  const maxTime = clip?.meta.duration ?? 0
  if (!maxTime)
    throw new Error('composeProtocol: protocol has no duration')

  const stream = combinator.output({ maxTime })
  const destroy = () => {
    combinator.destroy()
  }

  return {
    stream: wrapStreamWithCleanup(stream, destroy),
    width,
    height,
    durationMs: Math.round(maxTime / 1000),
    destroy,
  }
}
