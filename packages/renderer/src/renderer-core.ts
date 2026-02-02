import type { ITextSegment, IVideoFramesSegment, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { ComputedRef, Ref, ShallowRef } from '@vue/reactivity'
import type { Application, ApplicationOptions } from 'pixi.js'
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
import { MP4Clip } from '@webav/av-cliper'
import { file as opfsFile } from 'opfs-tools'
import { Container, Sprite, Texture } from 'pixi.js'
import { createApp as create2dApp } from './2d'
import { AudioManager } from './audio-manager'
import {
  applyDisplayProps,
  clamp,
  cloneProtocol,
  collectActiveSegments,
  collectResourceUrls,
  computeDuration,
  placeholder,
} from './helpers'
import { buildTextContent, buildTextCss, renderTextBitmap } from './text'

const DEFAULT_RES_DIR = '/video-editor-res'

export interface RendererOptions {
  protocol: MaybeRef<IVideoProtocol>
  app?: Application
  appOptions?: Partial<ApplicationOptions>
  resourceDir?: string
  autoPlay?: boolean
  freezeOnPause?: boolean
  manualRender?: boolean
  videoSourceMode?: 'auto' | 'mp4clip' | 'element'
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
  destroy: () => void
}

interface AudioManagerApi {
  sync: (currentTime: number, isPlaying: boolean) => void | Promise<void>
  ensureMp4Audio: (id: string, clip: MP4Clip, startUs: number, fps: number) => void
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
  const mp4ClipUnsupportedKeys = new Set<string>()
  const mp4ClipErrorLoggedKeys = new Set<string>()
  const videoSourceMode = opts.videoSourceMode ?? 'auto'
  type VideoEntry = (
    | {
      kind: 'mp4clip'
      clip: MP4Clip
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

  const currentTime = ref(0)
  const isPlaying = ref(false)
  const duration = computed(() => computeDuration(validatedProtocol.value))
  const audioManager: AudioManagerApi = new AudioManager(validatedProtocol.value) as unknown as AudioManagerApi

  let rafId: number | undefined
  let lastTickAt = 0
  let renderGeneration = 0

  interface RenderTask {
    app: Application
    layer: Container
    protocol: IVideoProtocol
    at: number
    getDisplay: (segment: SegmentUnion) => Promise<PixiDisplayObject | undefined>
  }

  async function renderScene(task: RenderTask) {
    const generation = renderGeneration
    const { protocol, at, layer } = task
    const renderAt = normalizeRenderTime(protocol, at)
    const active = collectActiveSegments(protocol, renderAt)
    const stageWidth = task.app.renderer.width
    const stageHeight = task.app.renderer.height

    audioManager.sync(at, isPlaying.value)

    const renders: (PixiDisplayObject | undefined)[] = []
    for (const { segment } of active) {
      if (generation !== renderGeneration)
        return
      const display = await task.getDisplay(segment)
      if (generation !== renderGeneration)
        return
      if (!display)
        continue
      if ((display as { destroyed?: boolean }).destroyed)
        continue
      applyDisplayProps(display, segment, stageWidth, stageHeight)
      if (isVideoSegment(segment))
        await updateVideoFrame(segment, renderAt)
      if (generation !== renderGeneration)
        return
      renders.push(display)
    }

    if (generation !== renderGeneration)
      return
    layer.removeChildren()
    const cleaned = renders.filter(Boolean) as PixiDisplayObject[]
    if (cleaned.length)
      layer.addChild(...cleaned)
    if (generation !== renderGeneration)
      return
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
        renderGeneration += 1
        clearDisplays()
        if (opts.warmUpResources !== false)
          warmUpResources(validatedProtocol.value)
        cleanupCache(validatedProtocol.value)
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

  function clearDisplays() {
    layer.removeChildren()
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
    lastTickAt = performance.now()
    rafId = requestAnimationFrame(loop)
  }

  function pause() {
    isPlaying.value = false
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
  }

  async function renderAt(time: number) {
    currentTime.value = clamp(time, 0, duration.value || Number.POSITIVE_INFINITY)
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

  async function buildTextDisplay(segment: ITextSegment): Promise<PixiDisplayObject | undefined> {
    const content = buildTextContent(segment.texts)
    if (!content)
      return undefined

    const [text] = segment.texts
    if (!text)
      return undefined

    const bitmap = await renderTextBitmap(content, buildTextCss(text))
    const texture = Texture.from(bitmap)
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

    const urlKey = getResourceKey(segment.url)
    const allowMp4Clip = videoSourceMode !== 'element'
    const allowVideoElement = videoSourceMode !== 'mp4clip'
    if (urlKey && mp4ClipUnsupportedKeys.has(urlKey)) {
      if (!allowVideoElement)
        throw new Error(`[renderer] MP4Clip unsupported for ${segment.url}`)
      const spriteFromElement = await loadVideoSpriteViaElement(segment.url).catch((err) => {
        console.warn('[renderer] failed to load video via <video>', segment.url, err)
        return undefined
      })
      if (spriteFromElement) {
        videoEntries.set(segment.id, spriteFromElement)
        return spriteFromElement.sprite
      }
      return undefined
    }

    if (allowMp4Clip) {
      const spriteFromClip = await loadVideoSpriteViaMP4Clip(segment.url).catch((err) => {
        if (urlKey && isMp4ClipUnsupported(err))
          mp4ClipUnsupportedKeys.add(urlKey)
        if (!urlKey || !mp4ClipErrorLoggedKeys.has(urlKey)) {
          if (urlKey)
            mp4ClipErrorLoggedKeys.add(urlKey)
          console.warn('[renderer] failed to load video via MP4Clip', segment.url, err)
        }
        if (!allowVideoElement)
          throw err
        return undefined
      })
      if (spriteFromClip) {
        console.info('[renderer] video source: mp4clip', segment.url)
        videoEntries.set(segment.id, spriteFromClip)
        return spriteFromClip.sprite
      }
    }

    if (allowVideoElement) {
      const spriteFromElement = await loadVideoSpriteViaElement(segment.url).catch((err) => {
        console.warn('[renderer] failed to load video via <video>', segment.url, err)
        return undefined
      })
      if (spriteFromElement) {
        console.info('[renderer] video source: element', segment.url)
        videoEntries.set(segment.id, spriteFromElement)
        return spriteFromElement.sprite
      }
    }

    return undefined
  }

  function isMp4ClipUnsupported(err: unknown) {
    if (!(err instanceof Error))
      return false
    const msg = err.message || ''
    return msg.includes('stream is done')
      || msg.includes('not emit ready')
      || msg.includes('tick video timeout')
  }

  async function updateVideoFrame(segment: IVideoFramesSegment, at: number) {
    const entry = videoEntries.get(segment.id)
    if (!entry)
      return

    try {
      const offsetMs = segment.fromTime ?? 0
      const relativeMs = Math.max(0, at - segment.startTime + offsetMs)
      const relativeUs = Math.floor(relativeMs * 1000)
      if (entry.kind === 'frozen') {
        const urlKey = getResourceKey(segment.url)
        if (!urlKey)
          return
        const revived = await loadVideoEntry(segment.url, urlKey, { sprite: entry.sprite, oldTexture: entry.texture })
        if (!revived)
          return
        videoEntries.set(segment.id, revived)
        return await updateVideoFrame(segment, at)
      }
      if (entry.kind === 'mp4clip') {
        try {
          const res = await entry.clip.tick(relativeUs)
          if (res.video) {
            const ctx = entry.canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(res.video, 0, 0, entry.canvas.width, entry.canvas.height)
              refreshCanvasTexture(entry.texture)
            }
            res.video.close()
          }
          // Play audio directly from tick result (avoid calling tick twice)
          if (isPlaying.value && res.audio && res.audio.length > 0) {
            const sampleRate = (entry.clip as { meta?: { audioSampleRate?: number } }).meta?.audioSampleRate ?? 48000;
            (audioManager as unknown as { playMp4AudioFrames: (id: string, audio: Float32Array[], sampleRate: number) => void })
              .playMp4AudioFrames(segment.id, res.audio as Float32Array[], sampleRate)
          }
          return
        }
        catch (err) {
          const urlKey = getResourceKey(segment.url)
          if (urlKey && isMp4ClipUnsupported(err)) {
            mp4ClipUnsupportedKeys.add(urlKey)
            entry.clip.destroy()
            if (videoSourceMode !== 'mp4clip') {
              const replacement = await loadVideoSpriteViaElement(segment.url, { sprite: entry.sprite, oldTexture: entry.texture }).catch((elementErr) => {
                console.warn('[renderer] failed to fallback to <video> after MP4Clip error', segment.url, elementErr)
                return undefined
              })
              if (replacement) {
                videoEntries.set(segment.id, replacement)
                return await updateVideoFrame(segment, at)
              }
            }
          }
          if (urlKey && !mp4ClipErrorLoggedKeys.has(urlKey)) {
            mp4ClipErrorLoggedKeys.add(urlKey)
            console.warn('[renderer] MP4Clip tick failed', segment.url, err)
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
        volume: segment.volume ?? 1,
      })
    }
    catch (err) {
      console.warn('[renderer] update video frame failed', err)
    }
  }

  async function loadVideoEntry(url: string, urlKey: string, reuse: { sprite: Sprite, oldTexture?: Texture }) {
    const allowMp4Clip = videoSourceMode !== 'element'
    const allowVideoElement = videoSourceMode !== 'mp4clip'
    if (mp4ClipUnsupportedKeys.has(urlKey)) {
      if (!allowVideoElement)
        throw new Error(`[renderer] MP4Clip unsupported for ${url}`)
      return await loadVideoSpriteViaElement(url, reuse).catch(() => undefined)
    }

    if (allowMp4Clip) {
      const fromClip = await loadVideoSpriteViaMP4Clip(url, reuse).catch((err) => {
        if (isMp4ClipUnsupported(err))
          mp4ClipUnsupportedKeys.add(urlKey)
        if (!allowVideoElement)
          throw err
        return undefined
      })
      if (fromClip)
        return fromClip
    }

    if (allowVideoElement)
      return await loadVideoSpriteViaElement(url, reuse).catch(() => undefined)

    return undefined
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

  function shouldUseResourceManager(url: string) {
    if (!url)
      return false
    if (url.startsWith('data:') || url.startsWith('blob:'))
      return false
    return true
  }

  function freezeVideoEntries() {
    for (const [id, entry] of videoEntries) {
      if (entry.kind === 'mp4clip') {
        entry.clip.destroy()
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
    if (entry.kind === 'mp4clip') {
      entry.clip.destroy()
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
      const cleanup = () => {
        window.clearTimeout(timer)
        target.removeEventListener(type, onOk)
        target.removeEventListener('error', onErr)
      }

      target.addEventListener(type, onOk, { once: true })
      target.addEventListener('error', onErr, { once: true })
    })
  }

  async function loadVideoSpriteViaMP4Clip(url: string, reuse?: { sprite: Sprite, oldTexture?: Texture }): Promise<VideoEntry | undefined> {
    let file: ReturnType<typeof opfsFile> | undefined
    if (shouldUseResourceManager(url)) {
      file = await getOpfsFile(url)
      if (!file) {
        await resourceManager.add(url).catch(() => {})
        file = await getOpfsFile(url)
      }
    }

    let clip: MP4Clip | undefined
    try {
      if (file) {
        clip = new MP4Clip(file)
      }
      else {
        const res = await fetch(url)
        if (!res.body) {
          const buffer = await res.arrayBuffer()
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(buffer))
              controller.close()
            },
          })
          clip = new MP4Clip(stream)
        }
        else {
          clip = new MP4Clip(res.body)
        }
      }

      await clip.ready

      const { width, height } = clip.meta
      const canvas = document.createElement('canvas')
      canvas.width = width || 1
      canvas.height = height || 1
      const texture = Texture.from(canvas)
      const sprite = reuse?.sprite ?? new Sprite(texture)
      if (reuse?.sprite) {
        reuse.sprite.texture = texture
        reuse.oldTexture?.destroy(true)
      }

      return { kind: 'mp4clip', clip, canvas, texture, sprite, meta: { width, height } }
    }
    catch (err) {
      clip?.destroy()
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
    video.muted = false
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


  async function updateVideoElementFrame(entry: Extract<VideoEntry, { kind: 'element' }>, opts: { targetSec: number, playbackRate: number, volume?: number }) {
    const { video, canvas, texture } = entry

    video.playbackRate = Number.isFinite(opts.playbackRate) && opts.playbackRate > 0 ? opts.playbackRate : 1
    video.volume = Math.max(0, Math.min(1, opts.volume ?? 1))

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
    renderGeneration += 1
    scope.stop()
    clearDisplays()
    layer.destroy({ children: true })
    displayCache.clear()
    displayLoading.clear()
    resourceWarmUp.clear()
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
