import type { IVideoFramesSegment, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { ComputedRef, Ref, ShallowRef } from '@vue/reactivity'
import type { Application, ApplicationOptions } from 'pixi.js'
import type { MaybeRef, PixiDisplayObject } from './types'
import { createResourceManager, createValidator } from '@video-editor/protocol'
import {
  computed,
  effectScope,
  isRef,
  ref,
  shallowRef,
  unref,
  watch,
} from '@vue/reactivity'
import { MP4Clip } from '@webav/av-cliper'
import { file as opfsFile } from 'opfs-tools'
import { Container, Sprite, Texture } from 'pixi.js'
import { createApp as create2dApp } from './2d'
import {
  applyDisplayProps,
  clamp,
  cloneProtocol,
  collectActiveSegments,
  collectResourceUrls,
  computeDuration,
  placeholder,
} from './helpers'

const DEFAULT_RES_DIR = '/video-editor-res'

export interface RendererOptions {
  protocol: MaybeRef<IVideoProtocol>
  app?: Application
  appOptions?: Partial<ApplicationOptions>
  resourceDir?: string
  autoPlay?: boolean
}

export interface Renderer {
  app: Application
  layer: Container
  currentTime: Ref<number>
  duration: ComputedRef<number>
  isPlaying: Ref<boolean>
  play: () => void
  pause: () => void
  tick: (deltaMs?: number) => void
  seek: (time: number) => void
  destroy: () => void
}

/**
 * Create a renderer that reacts to protocol updates and drives playback state.
 * - Pass a reactive `protocol` (Ref/readonly/normal object)
 * - Call `play/pause/seek/tick` to drive the timeline
 * - Rendering updates when `protocol` or `currentTime` changes
 */
export async function createRenderer(opts: RendererOptions): Promise<Renderer> {
  const validator = createValidator()
  const protocolInput: Ref<IVideoProtocol> | ShallowRef<IVideoProtocol>
    = isRef(opts.protocol) ? opts.protocol : shallowRef(opts.protocol)
  const validatedProtocol: ShallowRef<IVideoProtocol> = shallowRef(
    validator.verify(cloneProtocol(unref(protocolInput))),
  )

  const app = opts.app ?? await create2dApp(opts.appOptions)
  const layer = new Container()
  app.stage.addChild(layer)

  const resourceManager = createResourceManager({ dir: opts.resourceDir })
  const resourceWarmUp = new Set<string>()
  const displayCache = new Map<string, PixiDisplayObject>()
  const displayLoading = new Map<string, Promise<PixiDisplayObject | undefined>>()
  const videoEntries = new Map<string, {
    clip: MP4Clip
    canvas: HTMLCanvasElement
    texture: Texture
    sprite: Sprite
    meta?: { width: number, height: number }
  }>()

  const currentTime = ref(0)
  const isPlaying = ref(false)
  const duration = computed(() => computeDuration(validatedProtocol.value))

  let rafId: number | undefined
  let lastTickAt = 0

  interface RenderTask {
    app: Application
    layer: Container
    protocol: IVideoProtocol
    at: number
    getDisplay: (segment: SegmentUnion) => Promise<PixiDisplayObject | undefined>
  }

  async function renderScene(task: RenderTask) {
    const { protocol, at, layer } = task
    const renderAt = normalizeRenderTime(protocol, at)
    const active = collectActiveSegments(protocol, renderAt)
    const stageWidth = task.app.renderer.width
    const stageHeight = task.app.renderer.height

    const renders: (PixiDisplayObject | undefined)[] = []
    for (const { segment } of active) {
      const display = await task.getDisplay(segment)
      if (!display)
        continue
      applyDisplayProps(display, segment, stageWidth, stageHeight)
      if (isVideoSegment(segment))
        await updateVideoFrame(segment, renderAt)
      renders.push(display)
    }

    layer.removeChildren()
    const cleaned = renders.filter(Boolean) as PixiDisplayObject[]
    if (cleaned.length)
      layer.addChild(...cleaned)
    task.app.render()
  }

  const queueRender = createRenderQueue(() => renderScene({
    app,
    layer,
    protocol: validatedProtocol.value,
    at: currentTime.value,
    getDisplay: getDisplayForSegment,
  }))

  const scope = effectScope()
  scope.run(() => {
    // Sync external protocol mutations into a verified snapshot the renderer can rely on.
    watch(
      () => unref(protocolInput),
      (protocol) => {
        try {
          validatedProtocol.value = validator.verify(cloneProtocol(protocol))
        }
        catch (err) {
          console.error('[renderer] invalid protocol update', err)
          return
        }
        clearDisplays()
        warmUpResources(validatedProtocol.value)
        cleanupCache(validatedProtocol.value)
        clampCurrentTime()
        queueRender()
      },
      { deep: true, immediate: true },
    )

    // React to time changes.
    watch(currentTime, () => {
      clampCurrentTime()
      queueRender()
    })

    // Keep duration/currentTime in sync with protocol updates.
    watch(duration, () => clampCurrentTime())
  })

  function clampCurrentTime() {
    const nextDuration = duration.value
    if (nextDuration <= 0)
      currentTime.value = 0
    else if (currentTime.value > nextDuration)
      currentTime.value = nextDuration
    else if (currentTime.value < 0)
      currentTime.value = 0
  }

  function warmUpResources(protocol: IVideoProtocol) {
    for (const url of collectResourceUrls(protocol)) {
      if (resourceWarmUp.has(url))
        continue

      resourceWarmUp.add(url)
      resourceManager.add(url).catch(() => {
        // noop – render will fall back to Texture.from(url)
      })
    }
  }

  function cleanupCache(protocol: IVideoProtocol) {
    const ids = new Set(protocol.tracks.flatMap(track => track.children.map(seg => seg.id)))
    for (const [id, display] of displayCache) {
      if (ids.has(id))
        continue
      display.destroy()
      displayCache.delete(id)
    }
    for (const [id, entry] of videoEntries) {
      if (ids.has(id))
        continue
      entry.clip.destroy()
      videoEntries.delete(id)
    }
  }

  function clearDisplays() {
    layer.removeChildren()
    for (const display of displayCache.values()) {
      display.destroy()
    }
    displayCache.clear()
    displayLoading.clear()
    for (const { clip } of videoEntries.values())
      clip.destroy()
    videoEntries.clear()
  }

  function play() {
    if (isPlaying.value)
      return
    isPlaying.value = true
    lastTickAt = performance.now()
    rafId = requestAnimationFrame(loop)
  }

  function pause() {
    isPlaying.value = false
    if (rafId !== undefined)
      cancelAnimationFrame(rafId)
    rafId = undefined
  }

  function loop() {
    tick()
    if (isPlaying.value)
      rafId = requestAnimationFrame(loop)
  }

  function tick(deltaMs?: number) {
    if (!isPlaying.value && deltaMs === undefined)
      return

    const now = performance.now()
    const delta = deltaMs ?? (lastTickAt ? now - lastTickAt : 0)
    lastTickAt = now

    if (delta === 0)
      return

    currentTime.value = clamp(
      currentTime.value + delta,
      0,
      duration.value || Number.POSITIVE_INFINITY,
    )

    if (duration.value > 0 && currentTime.value >= duration.value)
      pause()

    // render happens via watch on currentTime
  }

  function seek(time: number) {
    currentTime.value = clamp(time, 0, duration.value || Number.POSITIVE_INFINITY)
  }

  async function getDisplayForSegment(segment: SegmentUnion) {
    const cached = displayCache.get(segment.id)
    if (cached)
      return cached

    const loading = displayLoading.get(segment.id)
    if (loading)
      return loading

    const promise = loadDisplay(segment)
    displayLoading.set(segment.id, promise)

    const display = await promise
    if (display)
      displayCache.set(segment.id, display)

    displayLoading.delete(segment.id)
    return display
  }

  async function loadDisplay(segment: SegmentUnion): Promise<PixiDisplayObject | undefined> {
    // prioritize static resources via protocol resource manager
    if (segment.segmentType === 'frames' || segment.segmentType === 'sticker') {
      if (!segment.url)
        return placeholder(segment.segmentType)

      if ('type' in segment && segment.type === 'video') {
        const sprite = await loadVideoSprite(segment)
        if (sprite)
          return sprite
      }

      const texture = await loadTexture(segment.url)
      if (texture)
        return new Sprite(texture)
      return placeholder(segment.segmentType, segment.url)
    }

    if (segment.segmentType === 'text')
      return undefined

    if (segment.segmentType === 'effect' || segment.segmentType === 'filter')
      return undefined

    // audio segments do not render visuals
    return undefined
  }

  async function loadTexture(url: string) {
    const isDataUrl = url.startsWith('data:')
    const isHttp = /^https?:\/\//.test(url)

    if (!isDataUrl && !isHttp) {
      try {
        await resourceManager.add(url)
        const res = await resourceManager.get(url)
        if (res instanceof HTMLImageElement)
          return Texture.from(res)
      }
      catch {
        // fall through to direct image load
      }
    }

    // load image directly to avoid invalid path issues with http/data URLs
    return await loadImageTexture(url)
  }

  async function loadVideoSprite(segment: SegmentUnion & { type: 'video', url: string }): Promise<Sprite | undefined> {
    const existing = videoEntries.get(segment.id)
    if (existing)
      return existing.sprite

    let file
    try {
      await resourceManager.add(segment.url)
      file = await getOpfsFile(segment.url)
    }
    catch {
      file = undefined
    }
    let clip: MP4Clip
    try {
      if (file) {
        clip = new MP4Clip(file)
      }
      else {
        const res = await fetch(segment.url)
        if (!res.body)
          return undefined
        clip = new MP4Clip(res.body)
      }
    }
    catch {
      return undefined
    }

    try {
      await clip.ready
    }
    catch {
      clip.destroy()
      return undefined
    }

    const { width, height } = clip.meta
    const canvas = document.createElement('canvas')
    canvas.width = width || 1
    canvas.height = height || 1
    const texture = Texture.from(canvas)
    const sprite = new Sprite(texture)

    videoEntries.set(segment.id, { clip, canvas, texture, sprite, meta: { width, height } })
    return sprite
  }

  async function updateVideoFrame(segment: IVideoFramesSegment, at: number) {
    const entry = videoEntries.get(segment.id)
    if (!entry)
      return

    try {
      const offsetMs = segment.fromTime ?? 0
      const relativeMs = Math.max(0, at - segment.startTime + offsetMs)
      const relativeUs = Math.floor(relativeMs * 1000)
      const res = await entry.clip.tick(relativeUs)
      if (res.video) {
        const ctx = entry.canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(res.video, 0, 0, entry.canvas.width, entry.canvas.height)
          refreshCanvasTexture(entry.texture)
        }
        res.video.close()
      }
    }
    catch (err) {
      console.warn('[renderer] update video frame failed', err)
    }
  }

  function isVideoSegment(segment: SegmentUnion): segment is IVideoFramesSegment {
    return segment.segmentType === 'frames'
      && segment.type === 'video'
      && typeof segment.url === 'string'
  }

  function normalizeRenderTime(protocol: IVideoProtocol, at: number) {
    const total = computeDuration(protocol)
    if (total <= 0)
      return 0
    if (at < total)
      return at
    // Keep the last visible frame when playback reaches the end.
    const frameWindow = Math.max(1000 / Math.max(protocol.fps || 30, 1), 1)
    return Math.max(total - frameWindow, 0)
  }

  async function getOpfsFile(url: string) {
    const dir = opts.resourceDir ?? DEFAULT_RES_DIR
    try {
      const file = opfsFile(`${dir}/${url}`)
      if (await file.exists())
        return file
    }
    catch {
      return undefined
    }
    return undefined
  }

  function loadImageTexture(url: string): Promise<Texture | undefined> {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(Texture.from(img))
      img.onerror = () => {
        console.warn('[renderer] failed to load image', url)
        resolve(undefined)
      }
      img.src = url
    })
  }

  function refreshCanvasTexture(texture: Texture) {
    const source = texture.source
    if ('update' in source && typeof source.update === 'function') {
      source.update()
      return
    }

    if (typeof texture.update === 'function')
      texture.update()
  }

  function destroy() {
    pause()
    scope.stop()
    clearDisplays()
    layer.destroy({ children: true })
    displayCache.clear()
    displayLoading.clear()
    resourceWarmUp.clear()
    if (!opts.app)
      app.destroy()
  }

  if (opts.autoPlay)
    play()

  return {
    app,
    layer,
    currentTime,
    duration,
    isPlaying,
    play,
    pause,
    tick,
    seek,
    destroy,
  }
}

function createRenderQueue(job: () => Promise<void> | void) {
  let queued = false
  let running = false

  const run = async () => {
    if (running) {
      queued = true
      return
    }
    running = true
    do {
      queued = false
      await job()
    } while (queued)
    running = false
  }

  return run
}
