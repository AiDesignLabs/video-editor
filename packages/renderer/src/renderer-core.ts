import type { IKeyframeProperty, ITextSegment, IVideoFramesSegment, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { VisualBox } from './gizmo-math'
import type { ComputedRef, Ref, ShallowRef } from '@vue/reactivity'
import type { Application, ApplicationOptions, Filter as PixiFilter } from 'pixi.js'
import type { ShaderEffectContext, TimelinePlan } from './timeline'
import type { MaybeRef, PixiDisplayObject } from './types'
import { createResourceManager, createValidator, getResourceKey } from '@video-editor/protocol'
import {
  computed,
  effectScope,
  isRef,
  ref,
  shallowRef,
  unref,
  watch,
} from '@vue/reactivity'
import type { MediaInputHandle } from '@video-editor/media'
import { openMediaInput } from '@video-editor/media'
import { file as opfsFile } from 'opfs-tools'
import { Container, ImageSource, Sprite, Texture } from 'pixi.js'
import { createApp as create2dApp } from './2d'
import { AudioManager } from './audio-manager'
import {
  applyDisplayProps,
  clamp,
  cloneProtocol,
  collectResourceUrls,
  computeDuration,
  isPlaceholderDisplay,
  placeholder,
} from './helpers'
import type { TextRun } from './text'
import { buildTextRuns, renderTextBitmap } from './text'
import { measureTextRuns } from './text-bitmap'
import {
  createEmptyEvaluatorState,
  createSegmentFilterCache,
  createPreviewAudioTicker,
  createPreviewRunner,
  createTimelineTransport,
  createVisualRenderItems,
  evaluateTimelinePlan,
} from './timeline'

const DEFAULT_RES_DIR = '/video-editor-res'
const VIDEO_PRELOAD_LOOKAHEAD_MS = 1500
const VIDEO_PRELOAD_LIMIT = 2

export interface RendererOptions {
  protocol: MaybeRef<IVideoProtocol>
  app?: Application
  appOptions?: Partial<ApplicationOptions>
  resourceDir?: string
  autoPlay?: boolean
  freezeOnPause?: boolean
  manualRender?: boolean
  videoSourceMode?: 'auto' | 'element'
  warmUpResources?: boolean
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
  renderAt: (time: number) => Promise<void>
  /** Geometry of every visual rendered in the last frame, in logical stage px. */
  getVisualBoxes: () => VisualBox[]
  destroy: () => void
}

const TRANSFORM_KEYFRAME_PROPERTIES: IKeyframeProperty[] = ['position.x', 'position.y', 'scale', 'rotation']

function hasTransformKeyframes(segment: SegmentUnion) {
  return Boolean(segment.keyframes?.some(
    track => TRANSFORM_KEYFRAME_PROPERTIES.includes(track.property) && track.frames.length > 0,
  ))
}

interface AudioManagerApi {
  setProtocol: (protocol: IVideoProtocol) => void
  applyTimelinePlan: (plan: TimelinePlan, isPlaying: boolean) => void
  resetTimelineState: (options?: { stop?: boolean }) => void
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
  const textDisplayIds = new Set<string>()
  let lastTextStageKey = ''
  const displayLoading = new Map<string, Promise<PixiDisplayObject | undefined>>()
  const decoderUnsupportedKeys = new Set<string>()
  const decoderErrorLoggedKeys = new Set<string>()
  const videoSourceMode = opts.videoSourceMode ?? 'auto'
  type VideoEntry = (
    | {
      kind: 'decoder'
      handle: MediaInputHandle
      canvas: HTMLCanvasElement
      texture: Texture
      sprite: Sprite
      meta?: { width: number, height: number }
    }
    | {
      kind: 'element'
      video: HTMLVideoElement
      canvas: HTMLCanvasElement
      texture: Texture
      sprite: Sprite
      meta?: { width: number, height: number }
    }
    | {
      kind: 'frozen'
      canvas: HTMLCanvasElement
      texture: Texture
      sprite: Sprite
      meta?: { width: number, height: number }
    }
  )
  const videoEntries = new Map<string, VideoEntry>()
  const videoObjectUrls = new Map<HTMLVideoElement, string>()
  const videoDisplayPreloading = new Set<string>()

  const currentTime = ref(0)
  const isPlaying = ref(false)
  const duration = computed(() => computeDuration(validatedProtocol.value))
  const mediaElementObjectUrls = new Map<string, string>()
  const mediaElementObjectUrlLoading = new Map<string, Promise<string | undefined>>()
  const audioManager: AudioManagerApi = new AudioManager(validatedProtocol.value, {
    resolveMediaElementUrl,
    loadVideoAudioBuffer,
  }) as unknown as AudioManagerApi
  const transport = createTimelineTransport({
    initialTimelineMs: currentTime.value,
    initialRate: 1,
    playing: false,
  })
  const previewRunner = createPreviewRunner({
    transport,
  })
  const previewAudioTicker = createPreviewAudioTicker({
    transport,
    runner: previewRunner,
    getProtocol: () => validatedProtocol.value,
    onPlan: (plan) => {
      applyAudioPlan(plan)
    },
  })

  let rafId: number | undefined
  let lastTickAt = 0
  let renderGeneration = 0
  let lastPlaceholderDisplays: PixiDisplayObject[] = []
  // Snapshot of the on-stage geometry of the last rendered frame; consumed by
  // canvas interaction overlays through `getVisualBoxes()`.
  let lastVisualBoxes: VisualBox[] = []

  interface RenderTask {
    app: Application
    layer: Container
    protocol: IVideoProtocol
    at: number
    getDisplay: (segment: SegmentUnion) => Promise<PixiDisplayObject | undefined>
  }

  function resetSchedulerState() {
    previewRunner.reset()
    audioManager.resetTimelineState({ stop: true })
  }

  function applyAudioPlan(plan: TimelinePlan) {
    audioManager.applyTimelinePlan(plan, isPlaying.value)
  }

  function syncAudioWithScheduler(protocol: IVideoProtocol, at: number) {
    if (isPlaying.value)
      return

    const plan = previewRunner.evaluate(protocol, at)
    applyAudioPlan(plan)
  }

  async function renderScene(task: RenderTask) {
    const generation = renderGeneration
    const { protocol, at, layer } = task
    const renderTimelineMs = normalizeRenderTime(protocol, at)
    const stageWidth = task.app.renderer.width
    const stageHeight = task.app.renderer.height

    // Text bitmaps are rasterized for a specific stage size/resolution; rebuild on change.
    const textStageKey = `${stageWidth}x${stageHeight}@${task.app.renderer.resolution || 1}`
    if (textStageKey !== lastTextStageKey) {
      lastTextStageKey = textStageKey
      for (const id of textDisplayIds) {
        const display = displayCache.get(id)
        if (display) {
          display.destroy()
          displayCache.delete(id)
        }
      }
      textDisplayIds.clear()
    }

    syncAudioWithScheduler(protocol, at)
    preloadUpcomingVideoDisplays(protocol, renderTimelineMs)

    const visualPlan = evaluateTimelinePlan(protocol, {
      atMs: renderTimelineMs,
      windowStartMs: renderTimelineMs,
      windowEndMs: renderTimelineMs,
      fps: Math.max(protocol.fps || 30, 1),
    }, createEmptyEvaluatorState()).plan.visuals
    const visualItems = createVisualRenderItems(protocol, visualPlan)
    const activeFilterSegmentIds = new Set<string>()

    const renders: (PixiDisplayObject | undefined)[] = []
    const boxes: VisualBox[] = []
    for (const visual of visualItems) {
      const { segment } = visual
      if (generation !== renderGeneration)
        return
      const display = await task.getDisplay(segment)
      if (generation !== renderGeneration)
        return
      if (!display)
        continue
      if ((display as { destroyed?: boolean }).destroyed)
        continue
      activeFilterSegmentIds.add(segment.id)
      applyVisualEffects(display, segment, visual.effects, {
        timeMs: renderTimelineMs,
        sourceTimeMs: visual.sourceTimeMs,
      })
      const { layout, baseWidth, baseHeight } = applyDisplayProps(display, segment, stageWidth, stageHeight, {
        opacity: visual.opacity,
        transform: visual.transform,
      })
      boxes.push({
        segmentId: segment.id,
        segmentType: segment.segmentType,
        zOrder: boxes.length,
        centerX: layout.centerX,
        centerY: layout.centerY,
        width: layout.width,
        height: layout.height,
        rotationRad: layout.rotationRad,
        baseWidth,
        baseHeight,
        hasTransformKeyframes: hasTransformKeyframes(segment),
      })
      if (isVideoSegment(segment))
        await updateVideoFrame(segment, visual.sourceTimeMs)
      if (generation !== renderGeneration)
        return
      renders.push(display)
    }

    if (generation !== renderGeneration)
      return
    evictInactiveSegmentFilters(activeFilterSegmentIds)
    layer.removeChildren()
    // Placeholders are not cached; destroy last frame's before rendering new ones.
    for (const display of lastPlaceholderDisplays)
      display.destroy()
    const cleaned = renders.filter(Boolean) as PixiDisplayObject[]
    lastPlaceholderDisplays = cleaned.filter(display => isPlaceholderDisplay(display))
    if (cleaned.length)
      layer.addChild(...cleaned)
    if (generation !== renderGeneration)
      return
    lastVisualBoxes = boxes
    task.app.render()
  }

  // Filters are reused across frames per segment: only a structural change
  // (different effect chain / newly active palette fields) rebuilds them,
  // animated params are pushed into the live filters each frame.
  const segmentFilterCache = createSegmentFilterCache()

  function evictInactiveSegmentFilters(activeIds: Set<string>) {
    segmentFilterCache.evictInactive(activeIds)
  }

  function clearSegmentFilterCache() {
    segmentFilterCache.clear()
  }

  function applyVisualEffects(
    display: PixiDisplayObject,
    segment: SegmentUnion,
    effects: TimelinePlan['visuals'][number]['effects'],
    ctx: ShaderEffectContext,
  ) {
    const palette = 'palette' in segment ? segment.palette : undefined
    const filters = segmentFilterCache.resolve(segment.id, effects, palette, ctx)

    ;(display as PixiDisplayObject & { filters?: PixiFilter[] | null }).filters
      = filters.length ? filters : null
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
        audioManager.setProtocol(validatedProtocol.value)
        resetSchedulerState()
        if (isPlaying.value)
          previewAudioTicker.tick()
        renderGeneration += 1
        clearDisplays()
        if (opts.warmUpResources !== false) {
          warmUpResources(validatedProtocol.value)
          warmUpMediaElementSources(validatedProtocol.value)
        }
        cleanupCache(validatedProtocol.value)
        cleanupMediaElementObjectUrls(validatedProtocol.value)
        clampCurrentTime()
        if (!opts.manualRender)
          queueRender()
      },
      { deep: true, immediate: true },
    )

    if (!opts.manualRender) {
      // React to time changes.
      watch(currentTime, () => {
        clampCurrentTime()
        queueRender()
      })
    }

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
      if (inferUrlMediaType(url) === 'video')
        continue
      if (!shouldUseResourceManager(url))
        continue
      resourceManager.add(url).catch(() => {
        // noop – render will fall back to Texture.from(url)
      })
    }
  }

  function warmUpMediaElementSources(protocol: IVideoProtocol) {
    for (const track of protocol.tracks) {
      for (const segment of track.children) {
        if (!isVideoSegment(segment))
          continue
        if ((segment.volume ?? 1) <= 0)
          continue
        void ensureMediaElementObjectUrl(segment.url)
      }
    }
  }

  function cleanupCache(protocol: IVideoProtocol) {
    const ids = new Set<string>()
    for (const track of protocol.tracks) {
      for (const child of track.children)
        ids.add(child.id)
    }
    for (const [id, display] of displayCache) {
      if (ids.has(id))
        continue
      display.destroy()
      displayCache.delete(id)
    }
    for (const [id, entry] of videoEntries) {
      if (ids.has(id))
        continue
      destroyVideoEntry(entry)
      videoEntries.delete(id)
    }
  }

  function cleanupMediaElementObjectUrls(protocol: IVideoProtocol) {
    const activeKeys = new Set<string>()
    for (const track of protocol.tracks) {
      for (const segment of track.children) {
        if (!isVideoSegment(segment))
          continue
        const key = getResourceKey(segment.url)
        if (key)
          activeKeys.add(key)
      }
    }

    for (const [key, objectUrl] of mediaElementObjectUrls) {
      if (activeKeys.has(key))
        continue
      URL.revokeObjectURL(objectUrl)
      mediaElementObjectUrls.delete(key)
    }
  }

  function clearDisplays() {
    layer.removeChildren()
    clearSegmentFilterCache()
    for (const display of displayCache.values()) {
      display.destroy()
    }
    displayCache.clear()
    displayLoading.clear()
    for (const entry of videoEntries.values())
      destroyVideoEntry(entry)
    videoEntries.clear()
  }

  function play() {
    if (isPlaying.value)
      return
    isPlaying.value = true
    const now = performance.now()
    transport.seek(currentTime.value, now)
    transport.play(now)
    previewAudioTicker.start()
    lastTickAt = now
    rafId = requestAnimationFrame(loop)
  }

  function pause() {
    isPlaying.value = false
    const now = performance.now()
    transport.pause(now)
    previewAudioTicker.stop()
    resetSchedulerState()
    if (rafId !== undefined)
      cancelAnimationFrame(rafId)
    rafId = undefined
    if (opts.freezeOnPause !== false)
      freezeVideoEntries()
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
    transport.seek(currentTime.value, performance.now())
    resetSchedulerState()
    if (isPlaying.value)
      previewAudioTicker.tick()
  }

  async function renderAt(time: number) {
    currentTime.value = clamp(time, 0, duration.value || Number.POSITIVE_INFINITY)
    transport.seek(currentTime.value, performance.now())
    resetSchedulerState()
    if (isPlaying.value)
      previewAudioTicker.tick()
    await queueRender()
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
    // Placeholders mark a failed load: show them this frame but do not cache,
    // so the next render retries the real resource.
    if (display && !isPlaceholderDisplay(display))
      displayCache.set(segment.id, display)

    displayLoading.delete(segment.id)
    return display
  }

  function preloadUpcomingVideoDisplays(protocol: IVideoProtocol, atMs: number) {
    const availableSlots = VIDEO_PRELOAD_LIMIT - videoDisplayPreloading.size
    if (availableSlots <= 0)
      return

    const windowEndMs = atMs + VIDEO_PRELOAD_LOOKAHEAD_MS
    const candidates: IVideoFramesSegment[] = []

    for (const track of protocol.tracks) {
      for (const segment of track.children) {
        if (!isVideoSegment(segment))
          continue
        if (segment.startTime <= atMs || segment.startTime > windowEndMs)
          continue
        if (displayCache.has(segment.id) || displayLoading.has(segment.id) || videoDisplayPreloading.has(segment.id))
          continue
        candidates.push(segment)
      }
    }

    candidates.sort((left, right) => left.startTime - right.startTime)
    for (const segment of candidates.slice(0, availableSlots))
      void preloadVideoDisplay(segment)
  }

  async function preloadVideoDisplay(segment: IVideoFramesSegment) {
    videoDisplayPreloading.add(segment.id)
    try {
      const display = await loadDisplay(segment)
      if (display && !displayCache.has(segment.id))
        displayCache.set(segment.id, display)
      await updateVideoFrame(segment, Math.max(segment.fromTime ?? 0, 0))
    }
    catch (err) {
      console.error('[renderer] failed to preload upcoming video segment', segment.url, err)
    }
    finally {
      videoDisplayPreloading.delete(segment.id)
    }
  }

  async function loadDisplay(segment: SegmentUnion): Promise<PixiDisplayObject | undefined> {
    // prioritize static resources via protocol resource manager
    if (segment.segmentType === 'frames' || segment.segmentType === 'sticker') {
      if (!segment.url)
        return placeholder(segment.segmentType)

      if ('type' in segment && segment.type === 'video') {
        if (isRenderableVideoUrl(segment.url)) {
          const sprite = await loadVideoSprite(segment)
          if (sprite)
            return sprite
          return placeholder(segment.segmentType, segment.url)
        }
      }

      const texture = await loadTexture(segment.url)
      if (texture)
        return new Sprite(texture)
      return placeholder(segment.segmentType, segment.url)
    }

    if (segment.segmentType === 'text')
      return await buildTextDisplay(segment)

    if (segment.segmentType === 'effect' || segment.segmentType === 'filter')
      return undefined

    // audio segments do not render visuals
    return undefined
  }

  function computeTextRasterScale(segment: ITextSegment, runs: TextRun[]) {
    const measured = measureTextRuns(runs)
    const stageWidth = Math.max(1, app.renderer.width)
    const stageHeight = Math.max(1, app.renderer.height)
    // Contain-fit magnification applied by the layout (undefined fillMode => contain).
    let magnification = Math.min(
      stageWidth / Math.max(1, measured.width),
      stageHeight / Math.max(1, measured.height),
    )
    const transformScale = segment.transform?.scale
    if (transformScale)
      magnification *= Math.max(Math.abs(transformScale[0] ?? 1), Math.abs(transformScale[1] ?? 1), 0.01)
    const resolution = app.renderer.resolution || 1
    const raw = magnification * resolution
    // Quantize to 0.5 steps to bound cache cardinality across resizes.
    return Math.min(8, Math.max(1, Math.round(raw * 2) / 2))
  }

  async function buildTextDisplay(segment: ITextSegment): Promise<PixiDisplayObject | undefined> {
    const runs = buildTextRuns(segment.texts)
    if (!runs.length)
      return undefined

    textDisplayIds.add(segment.id)
    const rendered = await renderTextBitmap(runs, computeTextRasterScale(segment, runs))
    // resolution maps the oversampled bitmap back to its CSS-pixel layout size.
    const texture = new Texture({
      source: new ImageSource({ resource: rendered.bitmap, resolution: rendered.scale }),
    })
    return new Sprite(texture)
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

    void ensureMediaElementObjectUrl(segment.url)
    const urlKey = getResourceKey(segment.url)
    const allowDecoder = videoSourceMode !== 'element'
    if (urlKey && decoderUnsupportedKeys.has(urlKey)) {
      const spriteFromElement = await loadVideoSpriteViaElement(segment.url).catch((err) => {
        console.error('[renderer] failed to load video via <video>', segment.url, err)
        return undefined
      })
      if (spriteFromElement) {
        videoEntries.set(segment.id, spriteFromElement)
        return spriteFromElement.sprite
      }
      return undefined
    }

    if (allowDecoder) {
      const spriteFromDecoder = await loadVideoSpriteViaDecoder(segment.url).catch((err) => {
        if (!urlKey || !decoderErrorLoggedKeys.has(urlKey)) {
          if (urlKey)
            decoderErrorLoggedKeys.add(urlKey)
          console.error('[renderer] failed to load video via decoder', segment.url, err)
        }
        return undefined
      })
      if (spriteFromDecoder) {
        videoEntries.set(segment.id, spriteFromDecoder)
        return spriteFromDecoder.sprite
      }
    }

    const spriteFromElement = await loadVideoSpriteViaElement(segment.url).catch((err) => {
      console.error('[renderer] failed to load video via <video>', segment.url, err)
      return undefined
    })
    if (spriteFromElement) {
      videoEntries.set(segment.id, spriteFromElement)
      return spriteFromElement.sprite
    }

    return undefined
  }

  async function updateVideoFrame(
    segment: IVideoFramesSegment,
    sourceTimeMs: number,
  ) {
    const entry = videoEntries.get(segment.id)
    if (!entry)
      return

    try {
      const relativeMs = Math.max(0, sourceTimeMs)
      if (entry.kind === 'frozen') {
        const urlKey = getResourceKey(segment.url)
        if (!urlKey)
          return
        const revived = await loadVideoEntry(segment.url, urlKey, { sprite: entry.sprite, oldTexture: entry.texture })
        if (!revived)
          return
        videoEntries.set(segment.id, revived)
        return await updateVideoFrame(segment, sourceTimeMs)
      }
      if (entry.kind === 'decoder') {
        try {
          const ctx = entry.canvas.getContext('2d')
          if (ctx) {
            const drawn = await entry.handle.drawFrame(ctx, relativeMs)
            if (drawn)
              refreshCanvasTexture(entry.texture)
          }
          return
        }
        catch (err) {
          const urlKey = getResourceKey(segment.url)
          if (urlKey) {
            decoderUnsupportedKeys.add(urlKey)
            entry.handle.dispose()
            const replacement = await loadVideoSpriteViaElement(segment.url, { sprite: entry.sprite, oldTexture: entry.texture }).catch((elementErr) => {
              console.error('[renderer] failed to fallback to <video> after decoder error', segment.url, elementErr)
              return undefined
            })
            if (replacement) {
              videoEntries.set(segment.id, replacement)
              return await updateVideoFrame(segment, sourceTimeMs)
            }
          }
          if (urlKey && !decoderErrorLoggedKeys.has(urlKey)) {
            decoderErrorLoggedKeys.add(urlKey)
            console.error('[renderer] decoder frame failed', segment.url, err)
          }
          return
        }
      }

      const relativeSec = relativeMs / 1000
      if (!Number.isFinite(relativeSec))
        return
      if (entry.kind !== 'element')
        return
      await updateVideoElementFrame(entry, {
        targetSec: relativeSec,
        playbackRate: segment.playRate ?? 1,
      })
    }
    catch (err) {
      console.error('[renderer] update video frame failed', err)
    }
  }

  async function loadVideoEntry(url: string, urlKey: string, reuse: { sprite: Sprite, oldTexture?: Texture }) {
    const allowDecoder = videoSourceMode !== 'element'
    if (decoderUnsupportedKeys.has(urlKey))
      return await loadVideoSpriteViaElement(url, reuse).catch(() => undefined)

    if (allowDecoder) {
      const fromDecoder = await loadVideoSpriteViaDecoder(url, reuse).catch(() => undefined)
      if (fromDecoder)
        return fromDecoder
    }

    return await loadVideoSpriteViaElement(url, reuse).catch(() => undefined)
  }

  function isVideoSegment(segment: SegmentUnion): segment is IVideoFramesSegment {
    return segment.segmentType === 'frames'
      && segment.type === 'video'
      && typeof segment.url === 'string'
      && isRenderableVideoUrl(segment.url)
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
      const key = getResourceKey(url)
      if (!key)
        return undefined
      const file = opfsFile(`${dir}/${key}`, 'r')
      if (await file.exists())
        return file
    }
    catch {
      return undefined
    }
    return undefined
  }

  async function loadVideoAudioBuffer(segment: IVideoFramesSegment): Promise<AudioBuffer | undefined> {
    if (!segment.url)
      return undefined
    let file: ReturnType<typeof opfsFile> | undefined
    if (shouldUseResourceManager(segment.url)) {
      await resourceManager.add(segment.url).catch(() => {})
      file = await getOpfsFile(segment.url)
    }
    const originFile = file ? await file.getOriginFile() : undefined
    const source = originFile ?? await (await fetch(segment.url)).blob()
    const handle = openMediaInput(source)
    try {
      if (!(await handle.canDecodeAudio()))
        return undefined
      const fromTimeMs = Math.max(0, segment.fromTime ?? 0)
      const playRate = Math.max(0.1, segment.playRate ?? 1)
      const spanMs = Math.max(0, segment.endTime - segment.startTime) * playRate
      if (spanMs <= 0)
        return undefined
      return await handle.decodeAudioSlice(fromTimeMs, fromTimeMs + spanMs)
    }
    catch {
      return undefined
    }
    finally {
      handle.dispose()
    }
  }

  function resolveMediaElementUrl(segment: { url: string, segmentType?: string, type?: string }) {
    if (segment.segmentType !== 'frames' || segment.type !== 'video')
      return undefined

    const key = getResourceKey(segment.url)
    if (!key)
      return undefined

    void ensureMediaElementObjectUrl(segment.url)
    return mediaElementObjectUrls.get(key)
  }

  async function ensureMediaElementObjectUrl(url: string): Promise<string | undefined> {
    if (!shouldUseResourceManager(url))
      return undefined

    const key = getResourceKey(url)
    if (!key)
      return undefined

    const existing = mediaElementObjectUrls.get(key)
    if (existing)
      return existing

    const loading = mediaElementObjectUrlLoading.get(key)
    if (loading)
      return await loading

    const job = (async () => {
      await resourceManager.add(url).catch(() => {})
      const file = await getOpfsFile(url)
      if (!file)
        return undefined

      const originFile = await file.getOriginFile()
      if (!originFile)
        return undefined

      const objectUrl = URL.createObjectURL(originFile)
      mediaElementObjectUrls.set(key, objectUrl)
      return objectUrl
    })()

    mediaElementObjectUrlLoading.set(key, job)
    try {
      return await job
    }
    finally {
      mediaElementObjectUrlLoading.delete(key)
    }
  }

  function shouldUseResourceManager(url: string) {
    if (!url)
      return false
    if (url.startsWith('data:') || url.startsWith('blob:'))
      return false
    return true
  }

  function freezeVideoEntries() {
    for (const [id, entry] of videoEntries) {
      if (entry.kind === 'decoder') {
        entry.handle.dispose()
        videoEntries.set(id, {
          kind: 'frozen',
          canvas: entry.canvas,
          texture: entry.texture,
          sprite: entry.sprite,
          meta: entry.meta,
        })
        continue
      }

      if (entry.kind === 'element')
        entry.video.pause()
    }
  }

  function destroyVideoEntry(entry: VideoEntry) {
    if (entry.kind === 'decoder') {
      entry.handle.dispose()
      return
    }

    if (entry.kind === 'frozen')
      return

    entry.video.pause()
    const objectUrl = videoObjectUrls.get(entry.video)
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      videoObjectUrls.delete(entry.video)
    }
    entry.video.removeAttribute('src')
    entry.video.load()
  }

  function waitForMediaEvent(target: HTMLMediaElement, type: string, timeoutMs = 1000) {
    return new Promise<void>((resolve, reject) => {
      let cleanup = () => {}
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for media event: ${type}`))
      }, timeoutMs)

      const onOk = () => {
        cleanup()
        resolve()
      }
      const onErr = () => {
        cleanup()
        const mediaError = target.error ? `${target.error.code}` : 'unknown'
        reject(new Error(`Media error (${mediaError}) while waiting for ${type}`))
      }
      cleanup = () => {
        window.clearTimeout(timer)
        target.removeEventListener(type, onOk)
        target.removeEventListener('error', onErr)
      }

      target.addEventListener(type, onOk, { once: true })
      target.addEventListener('error', onErr, { once: true })
    })
  }

  async function loadVideoSpriteViaDecoder(url: string, reuse?: { sprite: Sprite, oldTexture?: Texture }): Promise<VideoEntry | undefined> {
    let file: ReturnType<typeof opfsFile> | undefined
    if (shouldUseResourceManager(url)) {
      await resourceManager.add(url).catch(() => {})
      file = await getOpfsFile(url)
    }

    const originFile = file ? await file.getOriginFile() : undefined
    const source = originFile ?? await (await fetch(url)).blob()
    const handle = openMediaInput(source)
    try {
      if (!(await handle.canDecodeVideo())) {
        handle.dispose()
        const urlKey = getResourceKey(url)
        if (urlKey)
          decoderUnsupportedKeys.add(urlKey)
        return undefined
      }

      const { width, height } = await handle.meta()
      const canvas = document.createElement('canvas')
      canvas.width = width || 1
      canvas.height = height || 1
      const texture = Texture.from(canvas)
      const sprite = reuse?.sprite ?? new Sprite(texture)
      if (reuse?.sprite) {
        reuse.sprite.texture = texture
        reuse.oldTexture?.destroy(true)
      }

      return { kind: 'decoder', handle, canvas, texture, sprite, meta: { width, height } }
    }
    catch (err) {
      handle.dispose()
      throw err
    }
  }

  function inferUrlMediaType(url: string): 'video' | 'image' | 'audio' | 'unknown' {
    const raw = url.split('#')[0]!.split('?')[0]!
    const ext = raw.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''
    if (['mp4', 'm4v', 'mov', 'webm'].includes(ext))
      return 'video'
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext))
      return 'image'
    if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(ext))
      return 'audio'
    return 'unknown'
  }

  function isRenderableVideoUrl(url: string) {
    const kind = inferUrlMediaType(url)
    if (kind === 'image' || kind === 'audio')
      return false
    // Treat unknown as video to support blob URLs or extension-less endpoints.
    return true
  }

  async function loadVideoSpriteViaElement(url: string, reuse?: { sprite: Sprite, oldTexture?: Texture }): Promise<VideoEntry | undefined> {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    video.load()

    try {
      await waitForMediaEvent(video, 'loadedmetadata', 15000)
    }
    catch (err) {
      video.pause()
      const objectUrl = videoObjectUrls.get(video)
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        videoObjectUrls.delete(video)
      }
      video.removeAttribute('src')
      video.load()
      throw err
    }

    const width = video.videoWidth || 1
    const height = video.videoHeight || 1

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const texture = Texture.from(canvas)
    const sprite = reuse?.sprite ?? new Sprite(texture)
    if (reuse?.sprite) {
      reuse.sprite.texture = texture
      reuse.oldTexture?.destroy(true)
    }

    return { kind: 'element', video, canvas, texture, sprite, meta: { width, height } }
  }

  async function updateVideoElementFrame(entry: Extract<VideoEntry, { kind: 'element' }>, opts: { targetSec: number, playbackRate: number }) {
    const { video, canvas, texture } = entry

    video.playbackRate = Number.isFinite(opts.playbackRate) && opts.playbackRate > 0 ? opts.playbackRate : 1
    video.muted = true
    video.volume = 0

    if (isPlaying.value)
      video.play().catch(() => {})
    else
      video.pause()

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    const targetSec = duration ? Math.min(opts.targetSec, Math.max(duration - 0.03, 0)) : opts.targetSec

    const current = video.currentTime
    const drift = Math.abs(current - targetSec)
    const driftThreshold = isPlaying.value ? 0.25 : 0.03
    if (Number.isFinite(current) && drift > driftThreshold) {
      try {
        video.currentTime = targetSec
      }
      catch {
        // ignore seek errors for not-yet-ready media
      }
      await waitForMediaEvent(video, 'seeked', 250).catch(() => {})
    }

    if (video.readyState < 2) {
      // Avoid blocking the render queue for too long.
      await waitForMediaEvent(video, 'canplay', 250).catch(() => {})
      if (video.readyState < 2)
        return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx)
      return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    refreshCanvasTexture(texture)
  }

  function loadImageTexture(url: string): Promise<Texture | undefined> {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(Texture.from(img))
      img.onerror = () => {
        console.error('[renderer] failed to load image', url)
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
    renderGeneration += 1
    scope.stop()
    lastVisualBoxes = []
    clearDisplays()
    layer.destroy({ children: true })
    displayCache.clear()
    displayLoading.clear()
    resourceWarmUp.clear()
    for (const objectUrl of mediaElementObjectUrls.values())
      URL.revokeObjectURL(objectUrl)
    mediaElementObjectUrls.clear()
    mediaElementObjectUrlLoading.clear()
    if (!opts.app)
      app.destroy()

    audioManager.destroy()
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
    renderAt,
    getVisualBoxes: () => lastVisualBoxes.slice(),
    destroy,
  }
}

function createRenderQueue(job: () => Promise<void> | void) {
  let queued = false
  let running = false
  let pending: Promise<void> | null = null
  let resolvePending: (() => void) | null = null

  const run = async () => {
    if (!pending) {
      pending = new Promise((resolve) => {
        resolvePending = resolve
      })
    }
    const done = pending
    if (running) {
      queued = true
      return done
    }
    running = true
    do {
      queued = false
      await job()
    } while (queued)
    running = false
    resolvePending?.()
    pending = null
    resolvePending = null
    return done
  }

  return run
}
