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
import { getMp4Meta } from '@video-editor/protocol'
import { isAudioSegment, isVideoFramesSegment } from '@video-editor/shared'
import type { SegmentDragPayload, SegmentLayout, SegmentResizePayload, TimelineOverlaySlotProps, TimelineTrack } from '../VideoTimeline/types'
import type { TransitionEditPayload, TransitionSeam } from './types'
import { computed, reactive, ref, watch, watchEffect } from 'vue'
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
}>(), {
  protocol: null,
  snapStep: 0,
  selectedSegmentId: null,
  trackTypes: undefined,
  disableInteraction: false,
  showTrackRail: false,
})

const emit = defineEmits<{
  (e: 'update:currentTime', value: number): void
  (e: 'update:zoom', value: number): void
  (e: 'update:selectedSegmentId', value: string | null): void
  (e: 'segmentClick', payload: { segment: SegmentUnion, track: TrackUnion }): void
  (e: 'segmentDragEnd', payload: SegmentDragPayload): void
  (e: 'segmentResizeEnd', payload: SegmentResizePayload): void
  (e: 'videoSegmentMuteToggle', payload: { segment: IVideoFramesSegment, track: TrackUnion, muted: boolean }): void
  (e: 'add-segment', { track, startTime, endTime, event }: { track: TrackUnion, startTime: number, endTime?: number, event?: MouseEvent }): void
  (e: 'transition-edit', payload: TransitionEditPayload): void
  (e: 'track-toggle', payload: { trackId: string, field: 'hidden' | 'muted', value: boolean }): void
}>()

const innerSelectedId = ref<string | null>(props.selectedSegmentId ?? null)
watch(() => props.selectedSegmentId, (value) => {
  innerSelectedId.value = value ?? null
})

const PRIMARY_COLOR = '#222226'
const SURFACE_ALPHA = 0.4

const colorByType: Record<ITrackType, string> = {
  frames: PRIMARY_COLOR,
  audio: '#0ea5e9',
  text: '#16a34a',
  sticker: '#f97316',
  effect: '#a855f7',
  filter: '#64748b',
}

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
  const surface = toAlphaColor(accent, SURFACE_ALPHA)
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

function toAlphaColor(hex: string, alpha: number) {
  const normalized = hex.replace('#', '')
  if (!(normalized.length === 3 || normalized.length === 6))
    return hex
  const full = normalized.length === 3 ? normalized.split('').map(ch => ch + ch).join('') : normalized
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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
    emit('add-segment', { track: trackPayload, startTime, endTime, event })
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

  const rowTop = overlay.rulerHeight + mainLayout.trackIndex * (overlay.trackHeight + overlay.trackGap) + overlay.trackGap
  const top = rowTop + overlay.trackHeight / 2
  const ordered = mainLayout.segments.slice().sort((a, b) => a.segment.start - b.segment.start)

  const seams: TransitionSeam[] = []
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]
    const to = ordered[i + 1]
    if (!from || !to)
      continue
    // The main frames track has no gaps, so the boundary is a single point.
    const boundaryTime = from.segment.end
    seams.push({
      key: `${from.segment.id}->${to.segment.id}`,
      fromSegmentId: from.segment.id,
      toSegmentId: to.segment.id,
      boundaryTime,
      existing: findTransitionEdge(from.segment.id, to.segment.id),
      left: boundaryTime * overlay.pixelsPerMs,
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
  emit('transition-edit', payload)
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
  emit('track-toggle', {
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

    <!-- Pass through ruler slot -->
    <template v-if="$slots.ruler" #ruler="slotProps">
      <slot name="ruler" v-bind="slotProps" />
    </template>

    <!-- Pass through playhead slot -->
    <template v-if="$slots.playhead" #playhead="slotProps">
      <slot name="playhead" v-bind="slotProps" />
    </template>

    <template v-if="$slots['track-rail']" #track-rail="slotProps">
      <slot name="track-rail" v-bind="slotProps" />
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

    <!-- Per-track visibility / mute toggles, pinned to the row's left edge -->
    <template #track="{ track }">
      <div class="ve-track-controls">
        <button
          type="button"
          class="ve-track-toggle"
          :class="{ 've-track-toggle--off': track.hidden }"
          :title="track.hidden ? '显示轨道' : '隐藏轨道'"
          @mousedown.stop
          @click.stop="handleTrackToggle(track, 'hidden')"
        >
          <span
            class="ve-track-toggle__icon"
            :class="track.hidden ? 'i-creatly-invisible' : 'i-creatly-visible'"
            aria-hidden="true"
          />
        </button>
        <button
          v-if="canMuteTrack(track)"
          type="button"
          class="ve-track-toggle"
          :class="{ 've-track-toggle--off': track.muted }"
          :title="track.muted ? '取消静音' : '静音轨道'"
          @mousedown.stop
          @click.stop="handleTrackToggle(track, 'muted')"
        >
          <span
            class="ve-track-toggle__icon"
            :class="track.muted ? 'i-creatly-mute' : 'i-creatly-sound'"
            aria-hidden="true"
          />
        </button>
      </div>
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
                />
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'text'">
              <slot name="segment-text" :segment="segment as ITextSegment" :layout="layout">
                <TextSegment :segment="segment as ITextSegment" />
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'sticker'">
              <slot name="segment-sticker" :segment="segment as IStickerSegment" :layout="layout">
                <SegmentBase :segment="segment" :track-type="layout.track.type || 'unknown'" :accent-color="layout.track.color" />
              </slot>
            </template>
            <template v-else-if="segment.segmentType === 'audio'">
              <slot name="segment-audio" :segment="segment as IAudioSegment" :layout="layout">
                <AudioSegment :segment="segment as IAudioSegment" />
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
:where(.ve-editor-segment) {
  --at-apply: relative flex flex-col gap-1.5 w-full h-full;
  color: var(--ve-content-primary);
}

:where(.ve-editor-segment .ve-editor-segment__preview) {
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
  transition: opacity 0.12s ease, background-color 0.12s ease;
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

/* Track controls: faint until the row is hovered, always readable when active */
.ve-track-controls {
  position: absolute;
  left: 4px;
  top: 4px;
  z-index: 30;
  display: flex;
  gap: 2px;
  opacity: 0.25;
  transition: opacity 0.12s ease;
}

.ve-track:hover .ve-track-controls,
.ve-track-controls:focus-within {
  opacity: 1;
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
