<script setup lang="ts">
import type { ProjectMeta, SegmentAssetBinding } from '@video-editor/protocol'
import type { ExportTask, Renderer } from '@video-editor/renderer'
import type { IAudioSegment, IEffectSegment, IFilterSegment, IImageFramesSegment, IKeyframeProperty, IStickerSegment, ITextSegment, ITransform, IVideoFramesSegment, IVideoProtocol, SegmentUnion, TrackUnion } from '@video-editor/shared'
import type { SegmentUpdater, TransitionEditPayload } from '@video-editor/ui'
import type { Ref } from 'vue'
import type { ExportSettings } from './export-options'
import type { GizmoTransformPatch } from './gizmo/types'
import { createEditorCore } from '@video-editor/editor-core'
import { createMediaAssetCatalog, createProjectStore, generateThumbnails } from '@video-editor/protocol'
import { createExportTask, createRenderer, listEffectDefinitions, listTransitionDefinitions } from '@video-editor/renderer'
import { CanvasSizePanel, createDefaultToolbarActions, mergeToolbarActions, PropertyInspector, VideoEditorTimeline } from '@video-editor/ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, unref, watch } from 'vue'
import AssetPanel from './AssetPanel.vue'
import { toComposeOptions } from './export-options'
import ExportDialog from './ExportDialog.vue'
import CanvasGizmo from './gizmo/CanvasGizmo.vue'
import { clearBootCache, readBootCache, writeBootCache } from './project-boot'
import ProjectMenu from './ProjectMenu.vue'

const swatches = {
  primary: 'https://dummyimage.com/1280x720/6aa7ff/ffffff.png&text=Clip+A',
  alt: 'https://dummyimage.com/1280x720/f97316/ffffff.png&text=Clip+C',
  video: 'https://mogic-static.oss-cn-hangzhou.aliyuncs.com/test/output.mp4',
  audio: `https://creatly-public.oss-cn-shanghai.aliyuncs.com/test/audio-test.mp3`,
  extra: 'https://dummyimage.com/1280x720/22c55e/ffffff.png&text=Clip+D',
}

const initialProtocol: IVideoProtocol = {
  id: 'demo-protocol',
  version: '1.0.0',
  width: 1280,
  height: 720,
  fps: 30,
  extra: { projectName: 'Playground Demo' },
  tracks: [
    {
      trackId: 'filter-track',
      trackType: 'filter',
      children: [
        {
          id: 'filter-1',
          segmentType: 'filter',
          filterId: 'cool',
          name: '冷色调',
          intensity: 0.6,
          startTime: 5000,
          endTime: 9000,
        },
      ],
    },
    {
      trackId: 'effect-track',
      trackType: 'effect',
      children: [
        {
          id: 'effect-1',
          segmentType: 'effect',
          effectId: 'blur',
          name: '模糊',
          startTime: 13000,
          endTime: 16000,
        },
      ],
    },
    {
      trackId: 'sticker-track',
      trackType: 'sticker',
      children: [
        {
          id: 'sticker-1',
          segmentType: 'sticker',
          format: 'img',
          url: swatches.extra,
          startTime: 2000,
          endTime: 7000,
          extra: { label: 'Sticker' },
        },
      ],
    },
    {
      trackId: 'text-track',
      trackType: 'text',
      children: [
        {
          id: 'caption-1',
          segmentType: 'text',
          startTime: 0,
          endTime: 16000,
          opacity: 0.9,
          texts: [{ content: '你好，随便拖动时间轴', fontSize: 24, fill: 'rgba(248,250,252,1)' }],
          transform: {
            position: [0, 0.65, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          extra: { author: 'demo-bot' },
        },
      ],
    },
    {
      trackId: 'frames-track',
      trackType: 'frames',
      isMain: true,
      extra: { trackOwner: 'demo-owner' },
      children: [
        {
          id: 'clip-b',
          segmentType: 'frames',
          type: 'video',
          url: swatches.video,
          fromTime: 0,
          startTime: 3000,
          endTime: 9000,
          opacity: 1,
          volume: 1,
          extra: { aiTag: 'video-segment', confidence: 0.88, label: 'Big Buck Bunny (Sound)' },
        },
        {
          id: 'clip-c',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: swatches.alt,
          startTime: 9000,
          endTime: 16000,
          opacity: 1,
          extra: { aiTag: 'ending', confidence: 0.91, label: 'Clip C' },
        },
        {
          id: 'clip-a',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: swatches.primary,
          startTime: 0,
          endTime: 3000,
          opacity: 1,
          extra: { aiTag: 'warm-start', confidence: 0.96, label: 'Clip A' },
        },
      ],
    },
    {
      trackId: 'audio-track',
      trackType: 'audio',
      children: [
        {
          id: 'audio-1',
          segmentType: 'audio',
          url: swatches.audio,
          startTime: 0,
          endTime: 16000,
          volume: 1,
          fadeInDuration: 100,
          fadeOutDuration: 100,
          playRate: 1,
          extra: { label: 'Audio' },
        },
      ],
    },
  ],
}

const DEFAULT_PROJECT_ID = 'default'
const DEFAULT_PROJECT_NAME = '未命名项目'

/**
 * Boot straight into the last edited project.
 *
 * `createEditorCore` runs synchronously and offers no bulk protocol
 * replacement, while the OPFS project store is async — so the synchronous
 * localStorage boot cache (see `project-boot.ts`) decides the initial
 * protocol. A cached protocol that no longer validates is discarded.
 */
function bootstrapEditor() {
  const cached = readBootCache()
  if (cached) {
    try {
      return { editor: createEditorCore({ protocol: cached.protocol }), id: cached.id, name: cached.name }
    }
    catch (err) {
      console.error('[playground] cached project is invalid, falling back to the demo protocol', err)
      clearBootCache()
    }
  }
  return { editor: createEditorCore({ protocol: initialProtocol }), id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME }
}

const boot = bootstrapEditor()
const editor = boot.editor
const { state, commands } = editor
const protocol = state.protocol
const assetCatalog = createMediaAssetCatalog({
  getProtectedProtocols: getAssetProtectionProtocols,
})
const scrub = state.currentTime
const selectedSegmentId = computed({
  get: () => state.selectedSegmentId.value ?? null,
  set: value => commands.setSelectedSegment(value ?? undefined),
})

const mainFramesTrack = computed(() => {
  const framesTracks = state.trackMap.value.frames ?? []
  return framesTracks.find(track => track.isMain) ?? framesTracks[0]
})

const firstFrameSegment = computed(() => {
  return mainFramesTrack.value?.children[0]
})

const canvasHost = ref<HTMLDivElement | null>(null)
const renderer = shallowRef<Renderer | null>(null)
const thumbnailsState = reactive({
  items: [] as Array<{ tsMs: number, url: string }>,
  loading: false,
  error: null as string | null,
})
/**
 * View state derived from the export task. The task itself owns the lifecycle;
 * this only holds what the drawer needs on top of it — the object URL and the
 * download name, which are presentation concerns the library stays out of.
 */
const exportTask = shallowRef<ExportTask | null>(null)
const composeState = reactive({
  blobUrl: null as string | null,
  fileName: 'export.mp4',
})
const exportStatus = computed(() => exportTask.value?.state.value.status ?? 'pending')
const exportProgress = computed(() => exportTask.value?.state.value.progress ?? 0)
const exportElapsedMs = computed(() => exportTask.value?.state.value.elapsedMs ?? 0)
const exportRealtimeFactor = computed(() => exportTask.value?.state.value.realtimeFactor ?? 0)
const exportError = computed(() => exportTask.value?.state.value.error?.message ?? null)
const exportResult = computed(() => exportTask.value?.state.value.result ?? null)
const isExporting = computed(() => exportStatus.value === 'running')
const loading = ref(true)
const error = ref<string | null>(null)
const captionShifted = ref(false)
const timelineZoom = ref<number | undefined>(undefined)

type DrawerTab = 'assets' | 'compose' | 'thumbnails' | 'protocol' | 'demo'
const drawerOpen = ref(false)
const drawerTab = ref<DrawerTab>('assets')

function openDrawer(tab: DrawerTab) {
  if (drawerOpen.value && drawerTab.value === tab) {
    drawerOpen.value = false
    return
  }
  drawerTab.value = tab
  drawerOpen.value = true
}

// --- Project persistence ---------------------------------------------------

const projectStore = createProjectStore()

async function getAssetProtectionProtocols(): Promise<IVideoProtocol[]> {
  const projects = await projectStore.listProjects()
  const stored = await Promise.all(projects.map(project => projectStore.loadProject(project.id)))
  return [
    protocol.value,
    ...stored.flatMap(project => project ? [project.protocol] : []),
  ]
}
const currentProjectId = ref(boot.id)
const currentProjectName = ref(boot.name)
const projects = ref<ProjectMeta[]>([])
const lastSavedAt = ref<number | null>(null)
const AUTOSAVE_DELAY_MS = 2000
let autosaveTimer: number | undefined

async function refreshProjects() {
  try {
    projects.value = await projectStore.listProjects()
  }
  catch (err) {
    console.error('[playground] failed to list projects', err)
  }
}

function cancelScheduledSave() {
  if (autosaveTimer !== undefined) {
    window.clearTimeout(autosaveTimer)
    autosaveTimer = undefined
  }
}

/** Writes the active project to OPFS and mirrors it into the boot cache. */
async function persistProject() {
  cancelScheduledSave()
  const payload = {
    id: currentProjectId.value,
    name: currentProjectName.value,
    protocol: commands.exportProtocol(),
  }
  try {
    await projectStore.saveProject(payload)
    writeBootCache(payload)
    lastSavedAt.value = Date.now()
    await refreshProjects()
  }
  catch (err) {
    console.error('[playground] failed to save the project', err)
  }
}

function scheduleAutosave() {
  cancelScheduledSave()
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = undefined
    void persistProject()
  }, AUTOSAVE_DELAY_MS)
}

/**
 * Switching projects reloads the page: the boot cache carries the target
 * protocol across, which is the simplest correct swap while `editor-core`
 * exposes no bulk protocol replacement command.
 */
function rebootInto(project: { id: string, name: string, protocol: IVideoProtocol }) {
  writeBootCache(project)
  location.reload()
}

async function switchProject(id: string) {
  if (id === currentProjectId.value)
    return
  await persistProject()
  try {
    const stored = await projectStore.loadProject(id)
    if (!stored) {
      await refreshProjects()
      return
    }
    rebootInto({ id: stored.id, name: stored.name, protocol: stored.protocol })
  }
  catch (err) {
    console.error('[playground] failed to load the project', err)
  }
}

async function createProject() {
  await persistProject()
  const id = `p-${Date.now()}`
  const protocol = JSON.parse(JSON.stringify(initialProtocol)) as IVideoProtocol
  protocol.id = id
  const project = { id, name: DEFAULT_PROJECT_NAME, protocol }
  try {
    await projectStore.saveProject(project)
  }
  catch (err) {
    console.error('[playground] failed to create the project', err)
    return
  }
  rebootInto(project)
}

async function renameProject(name: string) {
  currentProjectName.value = name
  await persistProject()
}

async function deleteProject(id: string) {
  cancelScheduledSave()
  try {
    await projectStore.deleteProject(id)
  }
  catch (err) {
    console.error('[playground] failed to delete the project', err)
    return
  }
  await refreshProjects()

  if (id !== currentProjectId.value)
    return

  // The active project is gone: fall back to the newest survivor, or to a
  // fresh demo protocol when nothing is left.
  const next = projects.value[0]
  if (next) {
    const stored = await projectStore.loadProject(next.id)
    if (stored) {
      rebootInto({ id: stored.id, name: stored.name, protocol: stored.protocol })
      return
    }
  }
  clearBootCache()
  location.reload()
}

/** Adopts the newest stored project on a cold boot, or seeds the store. */
async function initProjects() {
  await refreshProjects()
  const newest = projects.value[0]
  if (!readBootCache() && newest) {
    const stored = await projectStore.loadProject(newest.id).catch(() => undefined)
    if (stored) {
      rebootInto({ id: stored.id, name: stored.name, protocol: stored.protocol })
      return
    }
  }
  if (!projects.value.some(project => project.id === currentProjectId.value))
    await persistProject()
}

watch(protocol, () => scheduleAutosave(), { deep: true })

const protocolDuration = computed(() => {
  const endTimes = protocol.value.tracks.flatMap(track => track.children.map(seg => seg.endTime))
  return endTimes.length ? Math.max(...endTimes) : 0
})

const durationMs = computed(() => renderer.value?.duration.value ?? protocolDuration.value)
const currentTimeMs = computed(() => renderer.value?.currentTime.value ?? scrub.value)
const isPlaying = computed(() => renderer.value?.isPlaying.value ?? false)
const selectedSegment = computed(() => state.selectedSegment.value ?? null)
const undoCount = computed(() => state.undoCount.value)
const redoCount = computed(() => state.redoCount.value)

const protocolPreview = computed(() => JSON.stringify(protocol.value, null, 2))

const thumbnailSourceUrl = computed(() => {
  const videoSegment = mainFramesTrack.value?.children.find(segment => segment.segmentType === 'frames' && segment.type === 'video')
  return videoSegment && 'url' in videoSegment ? videoSegment.url : swatches.video
})

/** Re-fit the preview whenever the project canvas changes. */
let refitPreview: (() => void) | undefined
watch(
  () => [protocol.value?.width, protocol.value?.height].join('x'),
  () => refitPreview?.(),
)

async function mountRendererInstance(options: {
  seekToMs?: number
  resumePlayback?: boolean
}) {
  const host = canvasHost.value
  const rendererOptions = {
    protocol,
    autoPlay: false,
    videoSourceMode: 'auto' as const,
    resolveAssetUrl: assetCatalog.resolveForPreview,
    appOptions: {
      ...fitToAspectRatio(
        host?.clientWidth || 1280,
        host?.clientHeight || 720,
        (protocol.value?.width ?? 16) / (protocol.value?.height ?? 9),
      ),
      // Video matte is black in both themes — deliberately not a theme token.
      background: '#000000',
    },
  }
  const instance = await createRenderer(rendererOptions)
  renderer.value = instance
  if (host) {
    host.replaceChildren(instance.app.canvas)
    refitPreview = observeCanvasHostResize(host, instance)
  }

  if (typeof options.seekToMs === 'number')
    instance.seek(options.seekToMs)

  scrub.value = instance.currentTime.value
  if (options.resumePlayback)
    instance.play()
}

const PREVIEW_MAX_RESOLUTION = 3
let hostResizeObserver: ResizeObserver | undefined
let lastRendererResizeKey = ''

/**
 * Largest box with the project's aspect ratio that fits inside the host.
 *
 * The preview used to be sized to the host element, so the stage took the shape
 * of its container and the project's own width/height only mattered on export.
 * Letterboxing here is what makes "change the canvas size" visible in the
 * preview at all.
 */
function fitToAspectRatio(hostWidth: number, hostHeight: number, ratio: number) {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
  const width = Math.min(hostWidth, hostHeight * safeRatio)
  const height = width / safeRatio
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

function observeCanvasHostResize(host: HTMLElement, instance: Renderer) {
  hostResizeObserver?.disconnect()
  const applyResize = () => {
    const ratio = (protocol.value?.width ?? 16) / (protocol.value?.height ?? 9)
    const box = fitToAspectRatio(
      Math.max(1, Math.round(host.clientWidth)),
      Math.max(1, Math.round(host.clientHeight)),
      ratio,
    )
    const dpr = window.devicePixelRatio || 1
    const resolution = Math.min(Math.max(dpr, 1), PREVIEW_MAX_RESOLUTION)
    const key = `${box.width}x${box.height}@${resolution}`
    if (key === lastRendererResizeKey)
      return
    lastRendererResizeKey = key

    instance.app.renderer.resize(box.width, box.height, resolution)
    // Pin the CSS box too, otherwise the canvas is stretched back to the host.
    const canvas = instance.app.canvas
    canvas.style.width = `${box.width}px`
    canvas.style.height = `${box.height}px`
    // The ticker is paused while not playing; re-render one frame at the new size.
    void instance.renderAt(instance.currentTime.value)
  }
  applyResize()
  hostResizeObserver = new ResizeObserver(applyResize)
  hostResizeObserver.observe(host)
  return applyResize
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  void initProjects()
  try {
    await mountRendererInstance({})
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
  finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  cancelScheduledSave()
  hostResizeObserver?.disconnect()
  hostResizeObserver = undefined
  renderer.value?.destroy()
  clearThumbnails()
  clearComposeOutput()
})

watch(renderer, (instance, _, onCleanup) => {
  if (!instance)
    return

  const stop = watch(
    () => instance.currentTime.value,
    (val) => {
      commands.setCurrentTime(val)
    },
    { immediate: true },
  )

  onCleanup(() => stop())
})

watch(durationMs, (val) => {
  if (scrub.value > val)
    commands.setCurrentTime(val)
})

function togglePlay() {
  const inst = renderer.value
  if (!inst)
    return
  if (inst.isPlaying.value)
    inst.pause()
  else
    inst.play()
}

function removeSelectedSegment(options?: { ripple?: boolean }) {
  const id = selectedSegmentId.value
  if (!id)
    return

  const result = commands.removeSegment(id, options)
  if (result.success)
    commands.setSelectedSegment(undefined)
}

/** Local clipboard for segment copy/paste, holds a detached protocol segment. */
const segmentClipboard = ref<SegmentUnion | null>(null)

function copySelectedSegment() {
  const selected = state.selectedSegment.value
  if (!selected)
    return
  segmentClipboard.value = JSON.parse(JSON.stringify(selected)) as SegmentUnion
}

function pasteClipboardSegment() {
  const clipboard = segmentClipboard.value
  if (!clipboard)
    return
  // addSegment re-anchors the copy at the playhead and regenerates a colliding id.
  const result = commands.addSegment(JSON.parse(JSON.stringify(clipboard)) as SegmentUnion)
  if (result.id)
    commands.setSelectedSegment(result.id)
}

function duplicateSelectedSegment() {
  const id = selectedSegmentId.value
  if (!id)
    return
  const result = commands.duplicateSegment(id)
  if (result.success)
    commands.setSelectedSegment(result.id)
}

function handleTrackToggle(payload: { trackId: string, field: 'hidden' | 'muted', value: boolean }) {
  commands.updateTrack(payload.trackId, (track) => {
    track[payload.field] = payload.value
  })
}

function handleInspectorUpdate(updater: SegmentUpdater) {
  const selected = state.selectedSegment.value
  if (!selected)
    return
  commands.updateSegment(updater, selected.id, selected.segmentType)
}

/**
 * A slider drag or a burst of typing in the inspector emits one
 * `update:segment` per step. The inspector brackets those with
 * interactionStart/End so the whole gesture collapses into one undo step.
 */
let inspectorTransaction: ReturnType<typeof commands.beginTransaction> | null = null

function handleInspectorInteractionStart() {
  inspectorTransaction?.commit()
  inspectorTransaction = commands.beginTransaction({ label: 'edit-segment-property' })
}

function handleInspectorInteractionEnd() {
  inspectorTransaction?.commit()
  inspectorTransaction = null
}

type TransformableSegment = SegmentUnion & { transform?: ITransform }

function isTransformable(segment: SegmentUnion): segment is TransformableSegment {
  return segment.segmentType === 'frames'
    || segment.segmentType === 'text'
    || segment.segmentType === 'sticker'
}

/** Insert or replace a keyframe on `property` at a segment-relative time. */
function upsertKeyframe(draft: SegmentUnion, property: IKeyframeProperty, value: number, timeMs: number) {
  const tracks = draft.keyframes ?? (draft.keyframes = [])
  let track = tracks.find(item => item.property === property)
  if (!track) {
    track = { property, frames: [] }
    tracks.push(track)
  }
  const existing = track.frames.find(frame => frame.timeMs === timeMs)
  if (existing)
    existing.value = value
  else
    track.frames.push({ timeMs, value })
  track.frames.sort((a, b) => a.timeMs - b.timeMs)
}

function handleGizmoSelect(segmentId: string | null) {
  commands.setSelectedSegment(segmentId ?? undefined)
}

/**
 * The gizmo emits a `transform` patch on every animation frame of a drag, and
 * each one is a protocol edit. Wrapping the gesture in a transaction keeps the
 * preview live while collapsing the whole drag into one undo step; cancelling
 * restores the transform captured at pointer down.
 */
let gizmoTransaction: ReturnType<typeof commands.beginTransaction> | null = null

function handleGizmoTransformStart() {
  gizmoTransaction?.cancel()
  gizmoTransaction = commands.beginTransaction({ label: 'transform-segment' })
}

function handleGizmoTransformEnd(payload: { cancelled: boolean }) {
  const transaction = gizmoTransaction
  gizmoTransaction = null
  if (!transaction)
    return
  if (payload.cancelled)
    transaction.cancel()
  else
    transaction.commit()
}

function handleGizmoTransform(patch: GizmoTransformPatch) {
  commands.updateSegment((draft) => {
    if (!isTransformable(draft))
      return

    if (patch.keyframed) {
      // Keyframed transforms win over the static one; write at the playhead.
      const timeMs = Math.max(0, Math.round(currentTimeMs.value - draft.startTime))
      if (patch.position) {
        upsertKeyframe(draft, 'position.x', patch.position.x, timeMs)
        upsertKeyframe(draft, 'position.y', patch.position.y, timeMs)
      }
      if (patch.scale)
        upsertKeyframe(draft, 'scale', patch.scale.x, timeMs)
      if (patch.rotationDeg !== undefined)
        upsertKeyframe(draft, 'rotation', patch.rotationDeg, timeMs)
      return
    }

    const transform: ITransform = draft.transform ?? {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }
    if (patch.position) {
      transform.position[0] = patch.position.x
      transform.position[1] = patch.position.y
    }
    if (patch.scale) {
      transform.scale[0] = patch.scale.x
      transform.scale[1] = patch.scale.y
    }
    if (patch.rotationDeg !== undefined)
      transform.rotation[2] = patch.rotationDeg
    draft.transform = transform
  }, patch.segmentId, patch.segmentType)
}

function splitSelectedSegment() {
  const id = selectedSegmentId.value
  if (!id)
    return

  const result = commands.splitSegment(id, currentTimeMs.value)
  if (result.success)
    commands.setSelectedSegment(result.rightId)
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing)
    return

  const target = event.target as HTMLElement | null
  const tagName = target?.tagName
  const isEditable = target?.isContentEditable
    || tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'

  if (isEditable)
    return

  const withMod = event.metaKey || event.ctrlKey

  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedSegmentId.value) {
    event.preventDefault()
    // Shift turns the delete into a ripple delete (following clips shift left).
    removeSelectedSegment({ ripple: event.shiftKey })
    return
  }

  if (withMod && event.key.toLowerCase() === 'c' && selectedSegmentId.value) {
    event.preventDefault()
    copySelectedSegment()
    return
  }

  if (withMod && event.key.toLowerCase() === 'v' && segmentClipboard.value) {
    event.preventDefault()
    pasteClipboardSegment()
    return
  }

  if (withMod && event.key.toLowerCase() === 'd' && selectedSegmentId.value) {
    event.preventDefault()
    duplicateSelectedSegment()
    return
  }

  if (withMod && event.key.toLowerCase() === 'b' && selectedSegmentId.value) {
    event.preventDefault()
    splitSelectedSegment()
    return
  }

  if (withMod && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey)
      commands.redo()
    else
      commands.undo()
    return
  }

  if (event.key === ' ') {
    event.preventDefault()
    togglePlay()
  }
}

function seekTo(time: number | Ref<number>) {
  const next = unref(time)
  renderer.value?.seek(next)
  commands.setCurrentTime(next)
}

function handleTimelineCurrentTime(next: number) {
  seekTo(next)
}

function handleTimelineSegmentClick(payload: { segment: SegmentUnion }) {
  commands.setSelectedSegment(payload.segment.id)
}

function handleSegmentDragEnd(payload: any) {
  commands.moveSegment({
    segmentId: payload.segment.id,
    sourceTrackId: payload.track.id,
    targetTrackId: payload.targetTrackId,
    startTime: payload.startTime,
    endTime: payload.endTime,
    isNewTrack: payload.isNewTrack,
    newTrackInsertIndex: payload.newTrackInsertIndex,
  })
}

function handleSegmentResizeEnd(payload: any) {
  commands.resizeSegment({
    segmentId: payload.segment.id,
    trackId: payload.track.id,
    startTime: payload.startTime,
    endTime: payload.endTime,
  })
}

function handleVideoSegmentMuteToggle(payload: { segment: SegmentUnion, muted: boolean }) {
  const segment = payload.segment
  if (segment.segmentType !== 'frames' || segment.type !== 'video')
    return
  commands.updateSegment((draft) => {
    if (draft.type === 'video')
      draft.volume = payload.muted ? 0 : 1
  }, segment.id, 'frames')
}

function swapMainClip() {
  const segmentId = firstFrameSegment.value?.id
  if (!segmentId)
    return

  commands.updateSegment((segment) => {
    segment.url = segment.url === swatches.primary ? swatches.alt : swatches.primary
  }, segmentId, 'frames')
}

function moveCaption() {
  const captionId = state.trackMap.value.text?.[0]?.children[0]?.id
  if (!captionId)
    return

  const shiftBy = 1000
  commands.updateSegment((segment) => {
    if (!captionShifted.value) {
      segment.startTime = shiftBy
      segment.endTime += shiftBy
      segment.texts[0].content = '字幕后移 1 秒'
    }
    else {
      segment.endTime -= segment.startTime
      segment.startTime = 0
      segment.texts[0].content = '字幕复位'
    }
  }, captionId, 'text')
  captionShifted.value = !captionShifted.value
}

function appendClip() {
  const duration = 5000
  const seg: IImageFramesSegment = {
    id: `clip-${Date.now()}`,
    segmentType: 'frames',
    type: 'image',
    format: 'img',
    url: swatches.extra,
    startTime: currentTimeMs.value,
    endTime: currentTimeMs.value + duration,
    opacity: 0.95,
    extra: { aiTag: 'appended', label: 'Clip D' },
  }
  commands.addSegment(seg)
}

/** Insert an imported asset at the playhead and select the created segment. */
function handleAssetAdd(asset: SegmentAssetBinding) {
  // addSegment always re-anchors startTime to the current time, so pin it first.
  commands.setCurrentTime(currentTimeMs.value)

  const label = asset.name

  if (asset.kind === 'audio') {
    const segment: Omit<IAudioSegment, 'id'> = {
      segmentType: 'audio',
      assetId: asset.assetId,
      url: asset.url,
      startTime: 0,
      endTime: asset.durationMs ?? 5000,
      volume: 1,
      extra: { label },
    }
    const result = commands.addSegment(segment, 'audio-track')
    commands.setSelectedSegment(result.id)
    return
  }

  const framesTrackId = mainFramesTrack.value?.trackId

  if (asset.kind === 'image') {
    const segment: Omit<IImageFramesSegment, 'id'> = {
      segmentType: 'frames',
      type: 'image',
      format: 'img',
      assetId: asset.assetId,
      url: asset.url,
      startTime: 0,
      endTime: 4000,
      extra: { label },
    }
    const result = commands.addSegment(segment, framesTrackId)
    commands.setSelectedSegment(result.id)
    return
  }

  const segment: Omit<IVideoFramesSegment, 'id'> = {
    segmentType: 'frames',
    type: 'video',
    assetId: asset.assetId,
    url: asset.url,
    startTime: 0,
    endTime: asset.durationMs ?? 5000,
    fromTime: 0,
    volume: 1,
    extra: { label },
  }
  const result = commands.addSegment(segment, framesTrackId)
  commands.setSelectedSegment(result.id)
}

async function handleAssetPreviewReady() {
  await renderer.value?.refreshAssets()
}

function clearThumbnails() {
  // Release object URLs before replacing them to avoid leaking memory in the demo.
  thumbnailsState.items.forEach(thumb => URL.revokeObjectURL(thumb.url))
  thumbnailsState.items = []
}

function clearComposeOutput() {
  if (composeState.blobUrl) {
    URL.revokeObjectURL(composeState.blobUrl)
  }
  composeState.blobUrl = null
}

async function runThumbnailDemo() {
  thumbnailsState.error = null
  thumbnailsState.loading = true
  clearThumbnails()

  try {
    const shots = await generateThumbnails(thumbnailSourceUrl.value, {
      imgWidth: 160,
      start: 0,
      end: 5_000_000,
      step: 800_000,
    })

    thumbnailsState.items = shots.map(thumb => ({
      tsMs: Math.round(thumb.ts / 1000),
      url: URL.createObjectURL(thumb.img),
    }))
  }
  catch (err) {
    thumbnailsState.error = err instanceof Error ? err.message : String(err)
  }
  finally {
    thumbnailsState.loading = false
  }
}

const exportDialogOpen = ref(false)

/** `20260828-153012`, stable and file-system friendly. */
function exportTimestamp() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

async function runCompose(settings: ExportSettings) {
  exportDialogOpen.value = false
  drawerTab.value = 'compose'
  drawerOpen.value = true
  clearComposeOutput()
  exportTask.value?.destroy()

  // The task snapshots the protocol, so edits made while it runs cannot land
  // half-way through the file.
  const composeOptions = toComposeOptions(settings)
  exportTask.value = createExportTask(protocol.value, {
    ...composeOptions,
    clipOptions: {
      ...composeOptions.clipOptions,
      rendererOptions: {
        ...composeOptions.clipOptions?.rendererOptions,
        resolveAssetUrl: assetCatalog.resolveForExport,
      },
    },
  })
  await awaitExport(task => task.start())
}

/** Runs `run` on the current task and turns a success into a downloadable file. */
async function awaitExport(run: (task: ExportTask) => Promise<unknown>) {
  const task = exportTask.value
  if (!task)
    return
  clearComposeOutput()
  await run(task)

  const result = task.state.value.result
  if (task.state.value.status !== 'success' || !result)
    return
  composeState.blobUrl = URL.createObjectURL(result.blob)
  composeState.fileName = `export-${exportTimestamp()}${result.fileExtension}`
}

function retryExport() {
  void awaitExport(task => task.retry())
}

function cancelExport() {
  exportTask.value?.cancel()
}

/**
 * A running export holds a decoder, a renderer and an encoder, and its result
 * only exists in this tab. Leaving without a word would silently throw all of
 * it away.
 */
function guardUnload(event: BeforeUnloadEvent) {
  if (!isExporting.value)
    return
  event.preventDefault()
  // Chrome ignores the message but still shows its own prompt when this is set.
  event.returnValue = ''
}

window.addEventListener('beforeunload', guardUnload)
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', guardUnload)
  exportTask.value?.destroy()
  clearComposeOutput()
})

/**
 * Presets offered by the filter/effect designer. `@video-editor/ui` cannot
 * depend on the renderer, so the host resolves the registry and passes it down.
 */
const effectPresets = computed(() => listEffectDefinitions()
  .filter(definition => !definition.id.startsWith('legacy:'))
  .map(definition => ({ id: definition.id, label: definition.label })))

// --- canvas size -----------------------------------------------------------
const canvasSizeError = ref<string | null>(null)
const fpsError = ref<string | null>(null)

function handleCanvasSizeChange(size: { width: number, height: number }) {
  const result = commands.setCanvasSize(size)
  // Surface the rejection instead of quietly snapping back to the old size.
  canvasSizeError.value = result.success ? null : (result.error ?? 'Invalid canvas size')
}

function handleFpsChange(fps: number) {
  const result = commands.setFps(fps)
  fpsError.value = result.success ? null : (result.error ?? 'Invalid frame rate')
}

// --- theme -----------------------------------------------------------------
// The spec requires light and dark; `data-theme` on <html> is what
// @video-editor/ui's token layer keys off, so the shell and the timeline flip
// together.
type ThemeName = 'light' | 'dark'
const THEME_STORAGE_KEY = 'video-editor-playground-theme'
const theme = ref<ThemeName>('light')

function applyTheme(next: ThemeName) {
  theme.value = next
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }
  catch {
    // private mode / storage disabled — the toggle still works for this session
  }
}

function toggleTheme() {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark')
}

onMounted(() => {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY)
  }
  catch {
    stored = null
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  applyTheme(stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light'))
})

// --- muting ----------------------------------------------------------------
// The renderer exposes no master-volume API, so the toolbar's speaker drives the
// per-track `muted` flags that already exist instead of faking a global one.
const audibleTracks = computed(() => (protocol.value?.tracks ?? []).filter(
  track => track.trackType === 'audio' || track.trackType === 'frames',
))
const masterMuted = computed(() => audibleTracks.value.length > 0
  && audibleTracks.value.every(track => track.muted === true))

function toggleMasterMute() {
  const next = !masterMuted.value
  for (const track of audibleTracks.value) {
    if (!track.trackId)
      continue
    commands.updateTrack(track.trackId, (draft) => {
      draft.muted = next
    })
  }
}

/** Nudge the playhead by whole frames, as the toolbar's frame-step buttons do. */
function stepFrame(direction: 1 | -1) {
  const fps = protocol.value?.fps || 30
  const frameMs = 1000 / Math.max(fps, 1)
  seekTo(Math.min(Math.max(currentTimeMs.value + direction * frameMs, 0), durationMs.value))
}

/** Mirrors the Figma toolbar's "15:59:00 自动保存云端" status line. */
const savedStatusLabel = computed(() => (
  lastSavedAt.value
    ? `${new Date(lastSavedAt.value).toLocaleTimeString('zh-CN', { hour12: false })} 已自动保存`
    : '尚未保存'
))

/**
 * The timeline's own toolbar, built from the package's standard set. The
 * playground only adds what the package cannot know about — here, the
 * autosave indicator — which is the same seam a business embed uses.
 */
const timelineToolbarActions = computed(() => mergeToolbarActions(
  createDefaultToolbarActions({
    onAdd: () => openDrawer('assets'),
    onDelete: () => removeSelectedSegment(),
    onSplit: splitSelectedSegment,
    onUndo: () => {
      // An open transaction blocks history navigation; commit what the user
      // has already typed or dragged, then undo that as one step.
      handleInspectorInteractionEnd()
      commands.undo()
    },
    onRedo: () => {
      handleInspectorInteractionEnd()
      commands.redo()
    },
    onTogglePlay: togglePlay,
    onStepBackward: () => stepFrame(-1),
    onStepForward: () => stepFrame(1),
    onToggleMute: toggleMasterMute,
    hasSelection: Boolean(selectedSegmentId.value),
    canUndo: Boolean(undoCount.value),
    canRedo: Boolean(redoCount.value),
    canPlay: Boolean(renderer.value),
    canStep: Boolean(renderer.value),
    isPlaying: isPlaying.value,
    muted: masterMuted.value,
    titles: { delete: '删除选中片段 (Delete，按住 Shift 为波纹删除)' },
  }),
  {
    add: [
      { id: 'saved', kind: 'status', icon: 'i-creatly-save', text: savedStatusLabel.value, after: 'redo' },
    ],
  },
))

function formatTimecode(value: number | Ref<number>) {
  const ms = Math.max(0, unref(value))
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`
}

function formatBytes(size: number) {
  if (size <= 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)))
  return `${(size / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`
}

function formatElapsedTime(ms: number) {
  const totalSeconds = Math.max(0, ms) / 1000
  if (totalSeconds < 60)
    return `${totalSeconds.toFixed(1)} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes} 分 ${(totalSeconds % 60).toFixed(1)} 秒`
}

function formatRealtimeFactor(factor: number) {
  if (!Number.isFinite(factor) || factor <= 0)
    return '—'
  return `${factor < 10 ? factor.toFixed(2) : factor.toFixed(1)}× 实时`
}

function formatPhaseTime(ms: number) {
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`
}

// --- Transition editor -----------------------------------------------------

const DEFAULT_TRANSITION_DURATION_MS = 500
// Shader transitions are registered by the renderer; the picker just lists them.
const transitionOptions = listTransitionDefinitions().map(def => ({ id: def.id, label: def.label }))

const transitionDialog = reactive({
  open: false,
  fromSegmentId: '',
  toSegmentId: '',
  boundaryTime: 0,
  hasExisting: false,
  transitionId: transitionOptions[0]?.id ?? 'crossfade',
  durationMs: DEFAULT_TRANSITION_DURATION_MS,
})

function handleTransitionEdit(payload: TransitionEditPayload) {
  transitionDialog.open = true
  transitionDialog.fromSegmentId = payload.fromSegmentId
  transitionDialog.toSegmentId = payload.toSegmentId
  transitionDialog.boundaryTime = payload.boundaryTime
  transitionDialog.hasExisting = Boolean(payload.existing)
  transitionDialog.transitionId = payload.existing?.id ?? transitionOptions[0]?.id ?? 'crossfade'
  transitionDialog.durationMs = payload.existing?.duration ?? DEFAULT_TRANSITION_DURATION_MS
}

function closeTransitionDialog() {
  transitionDialog.open = false
}

function confirmTransition() {
  const option = transitionOptions.find(item => item.id === transitionDialog.transitionId)
  if (!option)
    return
  const duration = Math.max(1, Math.round(transitionDialog.durationMs) || DEFAULT_TRANSITION_DURATION_MS)
  // Replace any existing edge on this boundary before adding the new one.
  if (transitionDialog.hasExisting)
    commands.removeTransition(transitionDialog.fromSegmentId)
  commands.addTransition({ id: option.id, name: option.label, duration }, transitionDialog.boundaryTime)
  closeTransitionDialog()
}

function removeTransitionEdge() {
  commands.removeTransition(transitionDialog.fromSegmentId)
  closeTransitionDialog()
}

function handleAddSegmentClick(data: {
  track: TrackUnion
  startTime: number
  endTime?: number
  event?: MouseEvent
}) {
  const { track, startTime, endTime } = data
  const duration = endTime ? endTime - startTime : 2000 // Default duration 2s

  commands.setCurrentTime(startTime)

  switch (track.trackType) {
    case 'frames': {
      const newSegment: Omit<IImageFramesSegment, 'id'> = {
        segmentType: 'frames',
        type: 'image',
        format: 'img',
        url: swatches.extra,
        startTime: 0,
        endTime: duration,
        opacity: 1,
        extra: { label: 'New Clip' },
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    case 'text': {
      const newSegment: Omit<ITextSegment, 'id'> = {
        segmentType: 'text',
        startTime: 0,
        endTime: duration,
        texts: [{ content: 'New Text', fontSize: 24, fill: '#ffffff' }],
        extra: null,
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    case 'audio': {
      const newSegment: Omit<IAudioSegment, 'id'> = {
        segmentType: 'audio',
        url: swatches.audio,
        startTime: 0,
        endTime: duration,
        volume: 1,
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    case 'filter': {
      const newSegment: Omit<IFilterSegment, 'id'> = {
        segmentType: 'filter',
        filterId: 'grayscale',
        name: '灰度',
        intensity: 0.8,
        startTime: 0,
        endTime: duration,
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    case 'effect': {
      const newSegment: Omit<IEffectSegment, 'id'> = {
        segmentType: 'effect',
        effectId: 'blur',
        name: '模糊',
        startTime: 0,
        endTime: duration,
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    case 'sticker': {
      const newSegment: Omit<IStickerSegment, 'id'> = {
        segmentType: 'sticker',
        format: 'img',
        url: swatches.extra,
        startTime: 0,
        endTime: duration,
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
  }
}
</script>

<template>
  <main class="studio">
    <header class="topbar">
      <div class="topbar__left">
        <button class="topbar__back" type="button" title="返回画布">
          <span class="topbar__back-icon i-creatly-return" aria-hidden="true" />
          <span>返回</span>
        </button>

        <ProjectMenu
          :projects="projects"
          :current-id="currentProjectId"
          :current-name="currentProjectName"
          :saved-at="lastSavedAt"
          @select="switchProject"
          @create="createProject"
          @rename="renameProject"
          @delete="deleteProject"
        />
      </div>

      <div class="topbar__mode" aria-label="工作区模式">
        <button class="topbar__mode-button topbar__mode-button--active" type="button">
          <span class="topbar__mode-icon i-creatly-preview" aria-hidden="true" />
          预览
        </button>
        <button class="topbar__mode-button" type="button" disabled>
          <span class="topbar__mode-icon i-creatly-comment" aria-hidden="true" />
          审片
        </button>
      </div>

      <div class="topbar__actions">
        <button class="tool" :title="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'" @click="toggleTheme">
          {{ theme === 'dark' ? '亮色' : '暗色' }}
        </button>
        <span class="topbar__divider" />
        <button class="tool" :class="{ 'tool--active': drawerOpen && drawerTab === 'assets' }" @click="openDrawer('assets')">
          素材
        </button>
        <button class="tool" :class="{ 'tool--active': drawerOpen && drawerTab === 'thumbnails' }" @click="openDrawer('thumbnails')">
          缩略图
        </button>
        <button class="tool" :class="{ 'tool--active': drawerOpen && drawerTab === 'protocol' }" @click="openDrawer('protocol')">
          协议
        </button>
        <button class="tool" :class="{ 'tool--active': drawerOpen && drawerTab === 'demo' }" @click="openDrawer('demo')">
          演示
        </button>
        <button class="export" :disabled="isExporting" @click="exportDialogOpen = true">
          <span v-if="!isExporting" class="export__icon i-creatly-download" aria-hidden="true" />
          {{ isExporting ? `导出中 ${Math.round(exportProgress * 100)}%` : '导出视频' }}
        </button>
      </div>
    </header>

    <section class="workspace">
      <div class="stage">
        <div class="stage__viewport">
          <div ref="canvasHost" class="stage__canvas" />
          <CanvasGizmo
            :renderer="renderer"
            :selected-segment-id="selectedSegmentId"
            :current-time-ms="currentTimeMs"
            :is-playing="isPlaying"
            @select="handleGizmoSelect"
            @transform="handleGizmoTransform"
            @transform-start="handleGizmoTransformStart"
            @transform-end="handleGizmoTransformEnd"
          />
          <div v-if="loading" class="stage__placeholder">
            正在初始化 Pixi 渲染器…
          </div>
          <div v-else-if="error" class="stage__placeholder stage__placeholder--error">
            初始化失败：{{ error }}
          </div>
        </div>
      </div>

      <aside class="side">
        <CanvasSizePanel
          class="side__canvas-size"
          :width="protocol.width"
          :height="protocol.height"
          :fps="protocol.fps"
          :error="canvasSizeError"
          :fps-error="fpsError"
          @change="handleCanvasSizeChange"
          @update:fps="handleFpsChange"
        />

        <PropertyInspector
          class="side__inspector"
          :segment="selectedSegment"
          :current-time-ms="currentTimeMs"
          :filter-presets="effectPresets"
          :effect-presets="effectPresets"
          @update:segment="handleInspectorUpdate"
          @interaction-start="handleInspectorInteractionStart"
          @interaction-end="handleInspectorInteractionEnd"
        />
      </aside>
    </section>

    <section class="rail">
      <VideoEditorTimeline
        v-model:zoom="timelineZoom"
        v-model:selected-segment-id="selectedSegmentId"
        class="rail__timeline"
        :protocol="protocol"
        :current-time="currentTimeMs"
        :track-types="['sticker', 'effect', 'filter', 'text', 'frames', 'audio']"
        :show-track-rail="true"
        :toolbar-actions="timelineToolbarActions"
        @update:current-time="handleTimelineCurrentTime"
        @segment-click="handleTimelineSegmentClick"
        @segment-drag-end="handleSegmentDragEnd"
        @segment-resize-end="handleSegmentResizeEnd"
        @video-segment-mute-toggle="handleVideoSegmentMuteToggle"
        @add-segment="handleAddSegmentClick"
        @transition-edit="handleTransitionEdit"
        @track-toggle="handleTrackToggle"
      >
        <template #toolbar-time>
          <div class="rail__clock">
            <span>{{ formatTimecode(currentTimeMs) }}</span>
            <span class="rail__clock-divider">/</span>
            <span>{{ formatTimecode(durationMs) }}</span>
          </div>
        </template>
      </VideoEditorTimeline>
    </section>

    <ExportDialog
      :open="exportDialogOpen"
      :source-width="protocol.width"
      :source-height="protocol.height"
      :source-fps="protocol.fps"
      @close="exportDialogOpen = false"
      @confirm="runCompose"
    />

    <div v-if="transitionDialog.open" class="transition-modal" @click.self="closeTransitionDialog">
      <div class="transition-card">
        <header class="transition-card__head">
          <strong>转场设置</strong>
          <span class="mono">{{ formatTimecode(transitionDialog.boundaryTime) }}</span>
        </header>

        <div class="transition-card__list">
          <button
            v-for="option in transitionOptions"
            :key="option.id"
            class="transition-option"
            :class="{ 'transition-option--active': option.id === transitionDialog.transitionId }"
            @click="transitionDialog.transitionId = option.id"
          >
            {{ option.label }}
          </button>
        </div>

        <label class="transition-card__field">
          <span>时长 (ms)</span>
          <input v-model.number="transitionDialog.durationMs" type="number" min="1" step="50">
        </label>

        <footer class="transition-card__foot">
          <button v-if="transitionDialog.hasExisting" class="tool tool--danger" @click="removeTransitionEdge">
            移除
          </button>
          <span class="transition-card__spacer" />
          <button class="tool" @click="closeTransitionDialog">
            取消
          </button>
          <button class="tool" @click="confirmTransition">
            确定
          </button>
        </footer>
      </div>
    </div>

    <section v-if="drawerOpen" class="drawer">
      <nav class="drawer__tabs">
        <button
          v-for="tab in ([['assets', '素材库'], ['compose', '合成输出'], ['thumbnails', '缩略图'], ['protocol', '协议 JSON'], ['demo', '演示操作']] as Array<[DrawerTab, string]>)"
          :key="tab[0]"
          class="drawer__tab"
          :class="{ 'drawer__tab--active': drawerTab === tab[0] }"
          @click="drawerTab = tab[0]"
        >
          {{ tab[1] }}
        </button>
        <button class="drawer__close" title="收起面板" @click="drawerOpen = false">
          收起 ▾
        </button>
      </nav>

      <div class="drawer__body">
        <div v-if="drawerTab === 'assets'" class="drawer__pane">
          <AssetPanel
            :catalog="assetCatalog"
            @add="handleAssetAdd"
            @preview-ready="handleAssetPreviewReady"
          />
        </div>

        <div v-else-if="drawerTab === 'compose'" class="drawer__pane">
          <div v-if="exportStatus === 'running'" class="compose-progress">
            <div class="compose-progress__bar">
              <div class="compose-progress__fill" :style="{ width: `${exportProgress * 100}%` }" />
            </div>
            <span class="mono">{{ Math.round(exportProgress * 100) }}%</span>
            <div class="compose-progress__metrics">
              <span>用时 <strong class="mono">{{ formatElapsedTime(exportElapsedMs) }}</strong></span>
              <span>速度 <strong class="mono">{{ formatRealtimeFactor(exportRealtimeFactor) }}</strong></span>
            </div>
            <button class="tool" @click="cancelExport">
              取消导出
            </button>
          </div>
          <template v-else-if="exportStatus === 'failed'">
            <p class="drawer__error">
              合成失败：{{ exportError }}
            </p>
            <div class="drawer__meta">
              <span class="mono">用时 {{ formatElapsedTime(exportElapsedMs) }}</span>
              <span class="mono">速度 {{ formatRealtimeFactor(exportRealtimeFactor) }}</span>
              <span class="drawer__hint">导出参数已保留，可直接重试。</span>
              <button class="tool" @click="retryExport">
                重试导出
              </button>
            </div>
          </template>
          <template v-else-if="exportStatus === 'cancelled'">
            <p class="drawer__empty">
              导出已取消。
            </p>
            <div class="drawer__meta">
              <span class="mono">用时 {{ formatElapsedTime(exportElapsedMs) }}</span>
              <span class="mono">速度 {{ formatRealtimeFactor(exportRealtimeFactor) }}</span>
              <button class="tool" @click="retryExport">
                重新导出
              </button>
            </div>
          </template>
          <template v-else-if="exportResult && composeState.blobUrl">
            <video class="compose-video" :src="composeState.blobUrl" controls />
            <div class="drawer__meta">
              <span class="mono">{{ formatTimecode(exportResult.durationMs) }}</span>
              <span class="mono">{{ formatBytes(exportResult.byteLength) }}</span>
              <span class="mono">用时 {{ formatElapsedTime(exportResult.elapsedMs) }}</span>
              <span class="mono">速度 {{ formatRealtimeFactor(exportResult.realtimeFactor) }}</span>
              <span class="drawer__hint mono">{{ composeState.fileName }}</span>
              <a class="tool" :href="composeState.blobUrl" :download="composeState.fileName">下载文件</a>
            </div>
            <dl class="compose-performance">
              <div>
                <dt>准备</dt>
                <dd class="mono">
                  {{ formatPhaseTime(exportResult.performance.setupMs) }}
                </dd>
              </div>
              <div>
                <dt>音频</dt>
                <dd class="mono">
                  {{ formatPhaseTime(exportResult.performance.audioMs) }}
                </dd>
              </div>
              <div>
                <dt>渲染 / 解码</dt>
                <dd class="mono">
                  {{ formatPhaseTime(exportResult.performance.renderMs) }}
                </dd>
              </div>
              <div>
                <dt>帧复制</dt>
                <dd class="mono">
                  {{ formatPhaseTime(exportResult.performance.captureMs) }}
                </dd>
              </div>
              <div>
                <dt>编码等待</dt>
                <dd class="mono">
                  {{ formatPhaseTime(exportResult.performance.encodeWaitMs) }}
                </dd>
              </div>
              <div>
                <dt>收尾</dt>
                <dd class="mono">
                  {{ formatPhaseTime(exportResult.performance.finalizeMs) }}
                </dd>
              </div>
            </dl>
          </template>
          <p v-else class="drawer__empty">
            点击右上角「导出视频」，在弹窗中选择分辨率、帧率、格式与编码后开始合成，结果会在这里预览与下载。
          </p>
        </div>

        <div v-else-if="drawerTab === 'thumbnails'" class="drawer__pane">
          <div class="drawer__meta">
            <button class="tool" :disabled="thumbnailsState.loading" @click="runThumbnailDemo">
              {{ thumbnailsState.loading ? '生成中…' : '生成缩略图' }}
            </button>
            <span class="drawer__hint mono">{{ thumbnailSourceUrl }}</span>
          </div>
          <p v-if="thumbnailsState.error" class="drawer__error">
            {{ thumbnailsState.error }}
          </p>
          <div v-else-if="thumbnailsState.items.length" class="thumb-grid">
            <figure v-for="thumb in thumbnailsState.items" :key="thumb.tsMs" class="thumb-grid__item">
              <img :src="thumb.url" :alt="`帧 ${formatTimecode(thumb.tsMs)}`">
              <figcaption class="mono">
                {{ formatTimecode(thumb.tsMs) }}
              </figcaption>
            </figure>
          </div>
          <p v-else class="drawer__empty">
            对主轨视频调用 generateThumbnails，抽帧结果显示在这里（OPFS 缓存，二次生成走缓存）。
          </p>
        </div>

        <div v-else-if="drawerTab === 'protocol'" class="drawer__pane">
          <pre class="protocol-json mono">{{ protocolPreview }}</pre>
        </div>

        <div v-else class="drawer__pane">
          <div class="drawer__meta">
            <button class="tool" @click="swapMainClip">
              切换主画面贴图
            </button>
            <button class="tool" @click="moveCaption">
              移动字幕
            </button>
            <button class="tool" @click="appendClip">
              在播放头追加片段
            </button>
          </div>
          <p class="drawer__empty">
            这些按钮直接调用 editor-core commands 修改 reactive protocol，预览与时间轴会同步更新；全部可用 Cmd/Ctrl+Z 撤销。
          </p>
        </div>
      </div>
    </section>
  </main>
</template>
