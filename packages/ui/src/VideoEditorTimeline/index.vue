<script setup lang="ts">
import type {
  IAudioSegment,
  IEffectSegment,
  IFilterSegment,
  IFramesSegmentUnion,
  IStickerSegment,
  ITextSegment,
  ITrackType,
  ITransitionEdge,
  IVideoFramesSegment,
  IVideoProtocol,
  SegmentUnion,
  TrackUnion,
} from '@video-editor/shared'
import type { ToolbarAction } from '../timeline/toolbar-actions'
import type { SegmentDragPayload, SegmentLayout, SegmentResizePayload, TimelineOverlaySlotProps, TimelineTrack } from '../VideoTimeline/types'
import type { TransitionEditPayload, TransitionSeam } from './types'
import { getMp4Meta } from '@video-editor/protocol'
import { isAudioSegment, isVideoFramesSegment } from '@video-editor/shared'
import { computed, reactive, ref, useSlots, watch, watchEffect } from 'vue'
import VideoTimeline from '../VideoTimeline/index.vue'
import { AudioSegment, FramesSegment, KeyframeMarkers, SegmentBase, TextSegment } from './segments'

defineOptions({ name: 'VideoEditorTimeline' })

const props = withDefaults(defineProps<{
  protocol?: IVideoProtocol | null
  currentTime: number
  zoom?: number
  snapStep?: number
  selectedSegmentId?: string | null
  trackTypes?: ITrackType[]
  disableInteraction?: boolean
  showTrackRail?: boolean
  /**
   * Per-track-type row height overrides, e.g. `{ audio: 48 }`. Empty by
   * default — every row is `trackHeight` (56px) unless a consumer opts in.
   */
  trackHeightByType?: Record<string, number>
  /** Declarative toolbar contents — see `createDefaultToolbarActions()`. */
  toolbarActions?: ToolbarAction[]
}>(), {
  protocol: null,
  snapStep: 0,
  selectedSegmentId: null,
  trackTypes: undefined,
  disableInteraction: false,
  showTrackRail: false,
  trackHeightByType: undefined,
  toolbarActions: undefined,
})

const emit = defineEmits<{
  (e: 'update:currentTime', value: number): void
  (e: 'update:zoom', value: number): void
  (e: 'update:selectedSegmentId', value: string | null): void
  (e: 'segmentClick', payload: { segment: SegmentUnion, track: TrackUnion }): void
  (e: 'segmentDragEnd', payload: SegmentDragPayload): void
  (e: 'segmentResizeEnd', payload: SegmentResizePayload): void
  (e: 'videoSegmentMuteToggle', payload: { segment: IVideoFramesSegment, track: TrackUnion, muted: boolean }): void
  (e: 'addSegment', { track, startTime, endTime, event }: { track: TrackUnion, startTime: number, endTime?: number, event?: MouseEvent }): void
  (e: 'transitionEdit', payload: TransitionEditPayload): void
  (e: 'trackToggle', payload: { trackId: string, field: 'hidden' | 'muted', value: boolean }): void
}>()

// Annotated on purpose: the template declares dynamic `#[name]` slots derived
// from this value, so leaving it inferred makes the component's own slot types
// circular and every read of it collapses to `any`.
const slots: Record<string, unknown> = useSlots()

/** Per-action toolbar override slots, forwarded down to VideoTimeline. */
const actionSlotNames = computed<string[]>(() => Object.keys(slots).filter(name => name.startsWith('action-')))

const innerSelectedId = ref<string | null>(props.selectedSegmentId ?? null)
watch(() => props.selectedSegmentId, (value) => {
  innerSelectedId.value = value ?? null
})

const PRIMARY_COLOR = '#222226'

const colorByType: Record<ITrackType, string> = {
  frames: PRIMARY_COLOR,
  audio: '#0ea5e9',
  text: '#16a34a',
  sticker: '#f97316',
  effect: '#a855f7',
  filter: '#64748b',
}

/**
 * No segment type tints its surface any more.
 *
 * Every segment component now paints its own token-driven background — media
 * types from the design, the rest from the "no media" language in SegmentBase —
 * so a tint behind them would only show through and mute those surfaces. Track
 * identity travels as `--ve-segment-accent` instead, which the components use
 * for their accent bar and icon.
 */
const SEGMENT_SURFACE = 'transparent'

const filteredTracks = computed(() => {
  if (!props.protocol?.tracks?.length)
    return [] as TrackUnion[]
  const tracks = !props.trackTypes?.length
    ? props.protocol.tracks
    : props.protocol.tracks.filter((track: TrackUnion) => props.trackTypes?.includes(track.trackType))
  const ordered = tracks.slice()
  const mainTrack = ordered.find(track => track.trackType === 'frames' && track.isMain === true)
  const nonAudioNonMainTracks = ordered.filter(track => !(track.trackType === 'audio' || track === mainTrack))
  const audioTracks = ordered.filter(track => track.trackType === 'audio')

  return [
    ...nonAudioNonMainTracks,
    ...(mainTrack ? [mainTrack] : []),
    ...audioTracks,
  ]
})

const videoDurationMsByUrl = reactive(new Map<string, number>())
const pendingVideoDurationJobs = new Map<string, Promise<void>>()

function ensureVideoDurationMs(url: string) {
  if (!url)
    return
  if (videoDurationMsByUrl.has(url))
    return
  if (pendingVideoDurationJobs.has(url))
    return

  const job = (async () => {
    try {
      const meta = await getMp4Meta(url)
      videoDurationMsByUrl.set(url, meta.durationMs)
    }
    catch {
      // ignore, leave duration unknown
    }
  })().finally(() => {
    pendingVideoDurationJobs.delete(url)
  })

  pendingVideoDurationJobs.set(url, job)
}

const timelineTracks = computed<TimelineTrack[]>(() => filteredTracks.value.map((track: TrackUnion, index: number) => {
  const accent = colorByType[track.trackType] || PRIMARY_COLOR
  const surface = SEGMENT_SURFACE
  const isMain = track.trackType === 'frames' && track.isMain === true
  return {
    id: track.trackId || `${track.trackType}-${index}`,
    label: track.trackType,
    type: track.trackType,
    color: accent,
    isMain,
    hidden: track.hidden === true,
    muted: track.muted === true,
    payload: track,
    segments: track.children.map((segment: SegmentUnion) => ({
      ...(isVideoFramesSegment(segment)
        ? { fromTime: segment.fromTime ?? 0, sourceDurationMs: videoDurationMsByUrl.get(segment.url) }
        : isAudioSegment(segment)
          ? { fromTime: segment.fromTime ?? 0 }
          : {}),
      id: segment.id,
      start: segment.startTime,
      end: segment.endTime,
      type: segment.segmentType,
      color: surface,
      payload: segment,
    })),
  }
}))

watchEffect(() => {
  for (const track of filteredTracks.value) {
    for (const segment of track.children) {
      if (isVideoFramesSegment(segment))
        ensureVideoDurationMs(segment.url)
    }
  }
})

const timelineDuration = computed(() => {
  if (!props.protocol?.tracks?.length)
    return 0
  const endTimes = props.protocol.tracks.flatMap(track => track.children.map(seg => seg.endTime))
  return endTimes.length ? Math.max(...endTimes) : 0
})

function resolveSegment(payload: unknown): SegmentUnion | null {
  if (payload && typeof payload === 'object' && 'segmentType' in (payload as SegmentUnion))
    return payload as SegmentUnion
  return null
}

function findTrackFromLayout(timelineTrack: TimelineTrack) {
  const trackFromPayload = timelineTrack.payload as TrackUnion | undefined
  if (trackFromPayload)
    return trackFromPayload
  if (props.protocol)
    return props.protocol.tracks.find((track: TrackUnion) => track.trackId === timelineTrack.id)
  return undefined
}

function emitSelection(id: string | null) {
  innerSelectedId.value = id
  emit('update:selectedSegmentId', id)
}

function handleTimelineSegmentClick(layout: SegmentLayout) {
  const segment = resolveSegment(layout.segment.payload)
  const track = findTrackFromLayout(layout.track) as TrackUnion | undefined
  if (!segment)
    return
  emitSelection(segment.id)
  if (track)
    emit('segmentClick', { segment, track })
}

function handleSegmentDragStart(payload: SegmentDragPayload) {
  // Select the segment when drag starts
  emitSelection(payload.segment.id)
}

function handleSegmentDragEnd(payload: SegmentDragPayload) {
  emit('segmentDragEnd', payload)
}

function handleSegmentResizeStart(payload: SegmentResizePayload) {
  // Select the segment when resize starts
  emitSelection(payload.segment.id)
}

function handleSegmentResizeEnd(payload: SegmentResizePayload) {
  emit('segmentResizeEnd', payload)
}

function handleAddSegment({ track, startTime, endTime, event }: { track: TimelineTrack, startTime: number, endTime?: number, event?: MouseEvent }) {
  const trackPayload = track.payload as TrackUnion
  if (trackPayload)
    emit('addSegment', { track: trackPayload, startTime, endTime, event })
}

const transitionEdges = computed<ITransitionEdge[]>(() => props.protocol?.transitions ?? [])

function findTransitionEdge(fromSegmentId: string, toSegmentId: string) {
  return transitionEdges.value.find(edge =>
    edge.fromSegmentId === fromSegmentId && edge.toSegmentId === toSegmentId)
}

/**
 * Seam chips live between adjacent main-track segments. The `#segment` slot
 * renders *inside* a segment box, so a boundary marker cannot be drawn there;
 * VideoTimeline's `overlay` slot shares the content coordinate box with the
 * playhead and drag previews, which is exactly what boundary positions need.
 */
function buildTransitionSeams(overlay: TimelineOverlaySlotProps): TransitionSeam[] {
  if (props.disableInteraction)
    return []
  const mainLayout = overlay.trackLayouts.find(layout => layout.track.isMain && layout.track.type === 'frames')
  if (!mainLayout || mainLayout.segments.length < 2)
    return []

  // Rows can differ in height, so read the resolved geometry rather than
  // multiplying out a uniform row.
  const index = mainLayout.trackIndex
  const rowHeight = overlay.trackHeights?.[index] ?? overlay.trackHeight
  const rowTop = overlay.rulerHeight + (overlay.trackTops?.[index] ?? index * (overlay.trackHeight + overlay.trackGap) + overlay.trackGap)
  const top = rowTop + rowHeight / 2
  const ordered = mainLayout.segments.slice().sort((a, b) => a.segment.start - b.segment.start)

  const seams: TransitionSeam[] = []
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]
    const to = ordered[i + 1]
    if (!from || !to)
      continue
    // The main frames track has no gaps, so the boundary is a single point.
    const boundaryTime = from.segment.end
    const left = boundaryTime * overlay.pixelsPerMs
    if (left < overlay.visibleStartPx || left > overlay.visibleEndPx)
      continue
    seams.push({
      key: `${from.segment.id}->${to.segment.id}`,
      fromSegmentId: from.segment.id,
      toSegmentId: to.segment.id,
      boundaryTime,
      existing: findTransitionEdge(from.segment.id, to.segment.id),
      left,
      top,
    })
  }
  return seams
}

function formatSeamDuration(durationMs: number) {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${Math.round(durationMs)}ms`
}

function handleTransitionSeamClick(seam: TransitionSeam) {
  const payload: TransitionEditPayload = {
    fromSegmentId: seam.fromSegmentId,
    toSegmentId: seam.toSegmentId,
    boundaryTime: seam.boundaryTime,
    existing: seam.existing,
  }
  emit('transitionEdit', payload)
}

/* Mirrors the per-type icons the segment components use, so the rail and the
   segment read as the same thing. `text`/`element`/`star`/`brush` all exist in
   the pinned @creatly/figma-icons; the previous fallbacks doubled up. */
const RAIL_ICON_BY_TRACK_TYPE: Record<string, string> = {
  frames: 'i-creatly-video',
  audio: 'i-creatly-audio',
  text: 'i-creatly-text',
  sticker: 'i-creatly-element',
  effect: 'i-creatly-star',
  filter: 'i-creatly-brush',
}

/** Icon shown in the track rail for a given track type. */
function resolveRailIcon(track: TimelineTrack) {
  return RAIL_ICON_BY_TRACK_TYPE[track.type ?? ''] ?? 'i-creatly-video'
}

/** Only tracks that can produce sound expose the mute toggle. */
function canMuteTrack(track: TimelineTrack) {
  return track.type === 'frames' || track.type === 'audio'
}

function resolveTrackId(track: TimelineTrack) {
  const trackPayload = track.payload as TrackUnion | undefined
  return trackPayload?.trackId ?? track.id
}

function handleTrackToggle(track: TimelineTrack, field: 'hidden' | 'muted') {
  emit('trackToggle', {
    trackId: resolveTrackId(track),
    field,
    value: !(track[field] === true),
  })
}

function handleVideoSegmentMuteToggle(segment: IVideoFramesSegment, track: TrackUnion, payload: { segmentId: string, muted: boolean }) {
  if (segment.id !== payload.segmentId)
    return
  emit('videoSegmentMuteToggle', { segment, track, muted: payload.muted })
}
</script>

<template>
  <VideoTimeline
    :tracks="timelineTracks"
    :duration="timelineDuration"
    :current-time="currentTime"
    :zoom="zoom"
    :fps="protocol?.fps || 30"
    :snap-step="snapStep"
    :selected-segment-id="innerSelectedId ?? null"
    :disable-interaction="disableInteraction"
    :show-track-rail="showTrackRail"
    :track-height-by-type="trackHeightByType"
    :toolbar-actions="toolbarActions"
    @update:current-time="emit('update:currentTime', $event)"
    @update:zoom="emit('update:zoom', $event)"
    @segment-click="handleTimelineSegmentClick"
    @segment-drag-start="handleSegmentDragStart"
    @segment-drag-end="handleSegmentDragEnd"
    @segment-resize-start="handleSegmentResizeStart"
    @segment-resize-end="handleSegmentResizeEnd"
    @background-click="emitSelection(null)"
    @add-segment="handleAddSegment"
  >
    <!-- Pass through toolbar slot -->
    <template v-if="$slots.toolbar" #toolbar="slotProps">
      <slot name="toolbar" v-bind="slotProps" />
    </template>

    <!-- Per-zone toolbar overrides (keeps the default toolbar chrome) -->
    <template v-if="$slots['toolbar-left']" #toolbar-left>
      <slot name="toolbar-left" />
    </template>
    <template v-if="$slots['toolbar-center']" #toolbar-center>
      <slot name="toolbar-center" />
    </template>
    <template v-if="$slots['toolbar-right']" #toolbar-right>
      <slot name="toolbar-right" />
    </template>
    <template v-if="$slots['toolbar-right-leading']" #toolbar-right-leading>
      <slot name="toolbar-right-leading" />
    </template>
    <template v-if="$slots['toolbar-right-trailing']" #toolbar-right-trailing>
      <slot name="toolbar-right-trailing" />
    </template>
    <template v-if="$slots['toolbar-time']" #toolbar-time="s">
      <slot name="toolbar-time" v-bind="s" />
    </template>

    <template v-if="$slots['toolbar-button']" #toolbar-button="s">
      <slot name="toolbar-button" v-bind="s" />
    </template>

    <!-- Per-action toolbar overrides, forwarded by name -->
    <template v-for="name in actionSlotNames" :key="name" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>

    <!-- Pass through ruler slot -->
    <template v-if="$slots.ruler" #ruler="slotProps">
      <slot name="ruler" v-bind="slotProps" />
    </template>

    <!-- Pass through playhead slot -->
    <template v-if="$slots.playhead" #playhead="slotProps">
      <slot name="playhead" v-bind="slotProps" />
    </template>

    <!-- The rail has a real default, so consumers only override it when they
         want something other than the stock design. It shows the track's type
         icon at rest and swaps to the visibility / mute toggles on row hover —
         the rail is the only 24px-wide column the design gives us, so the
         toggles live here rather than floating over the first segment. -->
    <template #track-rail="slotProps">
      <slot name="track-rail" v-bind="slotProps">
        <div class="ve-track-rail__cell">
          <span
            class="ve-track-rail__icon"
            :class="resolveRailIcon(slotProps.track)"
            aria-hidden="true"
          />
          <div class="ve-track-rail__controls">
            <button
              type="button"
              class="ve-track-toggle"
              :class="{ 've-track-toggle--off': slotProps.track.hidden }"
              :title="slotProps.track.hidden ? '显示轨道' : '隐藏轨道'"
              @mousedown.stop
              @click.stop="handleTrackToggle(slotProps.track, 'hidden')"
            >
              <span
                class="ve-track-toggle__icon"
                :class="slotProps.track.hidden ? 'i-creatly-invisible' : 'i-creatly-visible'"
                aria-hidden="true"
              />
            </button>
            <button
              v-if="canMuteTrack(slotProps.track)"
              type="button"
              class="ve-track-toggle"
              :class="{ 've-track-toggle--off': slotProps.track.muted }"
              :title="slotProps.track.muted ? '取消静音' : '静音轨道'"
              @mousedown.stop
              @click.stop="handleTrackToggle(slotProps.track, 'muted')"
            >
              <span
                class="ve-track-toggle__icon"
                :class="slotProps.track.muted ? 'i-creatly-mute' : 'i-creatly-sound'"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </slot>
    </template>

    <!-- Transition seams on the main frames track -->
    <template #overlay="overlay">
      <button
        v-for="seam in buildTransitionSeams(overlay)"
        :key="seam.key"
        type="button"
        class="ve-transition-seam"
        :class="{ 've-transition-seam--active': !!seam.existing }"
        :style="{ left: `${seam.left}px`, top: `${seam.top}px` }"
        :title="seam.existing ? `${seam.existing.name} · ${formatSeamDuration(seam.existing.duration)}` : '添加转场'"
        @click.stop="handleTransitionSeamClick(seam)"
        @mousedown.stop
      >
        <span v-if="seam.existing" class="ve-transition-seam__label">{{ formatSeamDuration(seam.existing.duration) }}</span>
        <span v-else class="ve-transition-seam__icon i-creatly-add" aria-hidden="true" />
      </button>
    </template>

    <template #segment="{ layout }">
      <template v-for="segment in [resolveSegment(layout.segment.payload)]" :key="segment?.id || layout.segment.id">
        <div
          v-if="segment"
          class="ve-editor-segment"
          :style="{ '--ve-segment-accent': layout.track.color || PRIMARY_COLOR }"
        >
          <KeyframeMarkers :segment="segment" />
          <div class="ve-editor-segment__preview">
            <!-- Separate slots by segment type for automatic type narrowing -->
            <template v-if="segment.segmentType === 'frames'">
              <slot name="segment-frames" :segment="segment as IFramesSegmentUnion" :layout="layout">
                <FramesSegment
                  :segment="segment"
                  @toggle-video-mute="handleVideoSegmentMuteToggle(segment as IVideoFramesSegment, layout.track.payload as TrackUnion, $event)"
                >
                  <!-- Forward FramesSegment's inner slots so consumers can restyle
                       one part without re-mounting the whole segment component. -->
                  <template v-if="$slots['frames-image']" #image="s">
                    <slot name="frames-image" v-bind="s" />
                  </template>
                  <template v-if="$slots['frames-video']" #video="s">
                    <slot name="frames-video" v-bind="s" />
                  </template>
                  <template v-if="$slots['frames-loading']" #loading="s">
                    <slot name="frames-loading" v-bind="s" />
                  </template>
                  <template v-if="$slots['frames-error']" #error="s">
                    <slot name="frames-error" v-bind="s" />
                  </template>
                  <template v-if="$slots['frames-empty']" #empty="s">
                    <slot name="frames-empty" v-bind="s" />
                  </template>
                  <template v-if="$slots['frames-fallback']" #fallback="s">
                    <slot name="frames-fallback" v-bind="s" />
                  </template>
                  <template v-if="$slots['frames-overlay']" #overlay="s">
                    <slot name="frames-overlay" v-bind="s" />
                  </template>
                </FramesSegment>
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'text'">
              <slot name="segment-text" :segment="segment as ITextSegment" :layout="layout">
                <TextSegment :segment="segment as ITextSegment" />
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'sticker'">
              <!-- Stickers render as media, like frames: only the image branch is
                   reachable for them, so just those inner slots are forwarded. -->
              <slot name="segment-sticker" :segment="segment as IStickerSegment" :layout="layout">
                <FramesSegment :segment="segment as IStickerSegment">
                  <template v-if="$slots['frames-image']" #image="s">
                    <slot name="frames-image" v-bind="s" />
                  </template>
                  <template v-if="$slots['frames-overlay']" #overlay="s">
                    <slot name="frames-overlay" v-bind="s" />
                  </template>
                </FramesSegment>
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'audio'">
              <slot name="segment-audio" :segment="segment as IAudioSegment" :layout="layout">
                <AudioSegment :segment="segment as IAudioSegment">
                  <template v-if="$slots['audio-waveform']" #waveform="s">
                    <slot name="audio-waveform" v-bind="s" />
                  </template>
                  <template v-if="$slots['audio-loading']" #loading="s">
                    <slot name="audio-loading" v-bind="s" />
                  </template>
                  <template v-if="$slots['audio-error']" #error="s">
                    <slot name="audio-error" v-bind="s" />
                  </template>
                  <template v-if="$slots['audio-empty']" #empty="s">
                    <slot name="audio-empty" v-bind="s" />
                  </template>
                  <template v-if="$slots['audio-overlay']" #overlay="s">
                    <slot name="audio-overlay" v-bind="s" />
                  </template>
                </AudioSegment>
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'effect'">
              <slot name="segment-effect" :segment="segment as IEffectSegment" :layout="layout">
                <SegmentBase :segment="segment" :track-type="layout.track.type || 'unknown'" :accent-color="layout.track.color" />
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'filter'">
              <slot name="segment-filter" :segment="segment as IFilterSegment" :layout="layout">
                <SegmentBase :segment="segment" :track-type="layout.track.type || 'unknown'" :accent-color="layout.track.color" />
              </slot>
            </template>
          </div>
        </div>
      </template>
    </template>
  </VideoTimeline>
</template>

<style scoped>
.ve-editor-segment {
  --at-apply: relative flex flex-col gap-1.5 w-full h-full;
  color: var(--ve-content-primary);
}

.ve-editor-segment .ve-editor-segment__preview {
  --at-apply: flex items-stretch w-full min-h-14;
}

/* Transition seam chip, centred on the boundary between two main-track clips */
.ve-transition-seam {
  --at-apply: absolute z-40 flex items-center justify-center h-5 min-w-5 px-1 rounded-full cursor-pointer;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  background: rgba(15, 23, 42, 0.55);
  color: #fff;
  font-size: 10px;
  line-height: 1;
  opacity: 0.28;
  transition:
    opacity 0.12s ease,
    background-color 0.12s ease;
}

.ve-transition-seam:hover {
  opacity: 1;
  background: rgba(15, 23, 42, 0.85);
}

.ve-transition-seam--active {
  opacity: 1;
  background: #6366f1;
  border-color: rgba(255, 255, 255, 0.85);
}

.ve-transition-seam--active:hover {
  background: #4f46e5;
}

/* Rail cell: type icon at rest, controls on row hover. */
.ve-track-rail__controls {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.ve-track:hover .ve-track-rail__controls,
.ve-track-rail__controls:focus-within {
  opacity: 1;
}

.ve-track:hover .ve-track-rail__icon {
  opacity: 0;
}

.ve-track-toggle {
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: var(--ve-surface-elevated);
  color: var(--ve-content-primary);
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.ve-track-toggle__icon,
.ve-transition-seam__icon {
  display: block;
  width: 12px;
  height: 12px;
}

.ve-track-toggle:hover {
  background: var(--ve-surface-control-hover);
}

.ve-track-toggle--off {
  opacity: 0.45;
  background: var(--ve-surface-control-muted);
}

.ve-transition-seam__label {
  --at-apply: font-mono;
  white-space: nowrap;
}
</style>
