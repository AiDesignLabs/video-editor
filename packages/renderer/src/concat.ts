import type { file as opfsFile } from 'opfs-tools'
import type { ICombinatorOpts } from '@webav/av-cliper'
import { Combinator, MP4Clip, OffscreenSprite } from '@webav/av-cliper'

export type VideoConcatSource =
  | string
  | ReadableStream<Uint8Array>
  | Blob
  | ReturnType<typeof opfsFile>

export interface ConcatVideoSource {
  source: VideoConcatSource
}

export interface ConcatVideoOptions extends Omit<ICombinatorOpts, 'width' | 'height'> {
  width?: number
  height?: number
  onProgress?: (progress: number) => void
}

export interface ConcatVideoResult {
  stream: ReadableStream<Uint8Array>
  width: number
  height: number
  durationMs: number
  destroy: () => void
}

function isOpfsFile(value: unknown): value is ReturnType<typeof opfsFile> {
  return typeof value === 'object'
    && value !== null
    && 'createReader' in value
    && 'getSize' in value
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream
}

function normalizeInput(input: ConcatVideoSource | VideoConcatSource): ConcatVideoSource {
  if (typeof input === 'string' || input instanceof Blob || isOpfsFile(input) || isReadableStream(input))
    return { source: input }
  return input
}

async function toClipSource(source: VideoConcatSource): Promise<ReadableStream<Uint8Array> | ReturnType<typeof opfsFile>> {
  if (typeof source === 'string') {
    const res = await fetch(source)
    if (!res.body)
      throw new Error('concatVideos: unable to read video stream from url')
    return res.body
  }

  if (source instanceof Blob)
    return source.stream() as ReadableStream<Uint8Array>

  return source
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

export async function concatVideos(
  inputs: Array<ConcatVideoSource | VideoConcatSource>,
  opts: ConcatVideoOptions = {},
): Promise<ConcatVideoResult> {
  if (inputs.length === 0)
    throw new Error('concatVideos: expected at least one source')

  const {
    onProgress,
    width: requestedWidth,
    height: requestedHeight,
    ...combinatorOpts
  } = opts

  const normalized = inputs.map(normalizeInput)

  const [first, ...rest] = normalized
  const firstSource = await toClipSource(first.source)
  const firstClip = new MP4Clip(firstSource)
  await firstClip.ready

  const width = requestedWidth ?? Math.round(firstClip.meta.width || 0)
  const height = requestedHeight ?? Math.round(firstClip.meta.height || 0)
  if (!width || !height)
    {
      firstClip.destroy()
      throw new Error('concatVideos: output width/height is required')
    }

  const combinator = new Combinator({
    ...combinatorOpts,
    width,
    height,
  })

  if (onProgress)
    combinator.on('OutputProgress', onProgress)

  let offset = 0

  const addClip = async (clip: MP4Clip) => {
    const duration = clip.meta.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      clip.destroy()
      throw new Error('concatVideos: invalid clip duration')
    }

    const sprite = new OffscreenSprite(clip)
    try {
      await sprite.ready
      sprite.rect.x = 0
      sprite.rect.y = 0
      sprite.rect.w = width
      sprite.rect.h = height
      sprite.time.offset = offset
      sprite.time.duration = duration

      await combinator.addSprite(sprite)
      offset += duration
    }
    finally {
      sprite.destroy()
    }
  }

  try {
    await addClip(firstClip)
    for (const entry of rest) {
      const source = await toClipSource(entry.source)
      const clip = new MP4Clip(source)
      await clip.ready
      await addClip(clip)
    }
  }
  catch (err) {
    combinator.destroy()
    throw err
  }

  const maxTime = offset
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
