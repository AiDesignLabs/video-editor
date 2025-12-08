<script setup lang="ts">
import type {
  ITrackType,
  IVideoProtocol,
  SegmentUnion,
  TrackUnion,
} from '@video-editor/shared'
import type { SegmentDragPayload, SegmentLayout, SegmentResizePayload, TimelineTrack } from '../VideoTimeline/types'
import { computed, ref, watch } from 'vue'
import VideoTimeline from '../VideoTimeline/index.vue'
import { FramesSegment, SegmentBase } from './segments'

defineOptions({ name: 'VideoEditorTimeline' })

const props = withDefaults(defineProps<{
  protocol?: IVideoProtocol | null
  currentTime: number
  zoom?: number
  snapStep?: number
  selectedSegmentId?: string | null
  trackTypes?: ITrackType[]
  disableInteraction?: boolean
}>(), {
  protocol: null,
  snapStep: 0,
  selectedSegmentId: null,
  trackTypes: undefined,
  disableInteraction: false,
})

const emit = defineEmits<{
  (e: 'update:protocol', protocol: IVideoProtocol): void
  (e: 'update:currentTime', value: number): void
  (e: 'update:zoom', value: number): void
  (e: 'update:selectedSegmentId', value: string | null): void
  (e: 'segmentClick', payload: { segment: SegmentUnion, track: TrackUnion }): void
  (e: 'segmentDragEnd', payload: { segment: SegmentUnion, track: TrackUnion, protocol: IVideoProtocol }): void
  (e: 'segmentResizeEnd', payload: { segment: SegmentUnion, track: TrackUnion, protocol: IVideoProtocol }): void
}>()

const innerSelectedId = ref<string | null>(props.selectedSegmentId ?? null)
watch(() => props.selectedSegmentId, (value) => {
  innerSelectedId.value = value ?? null
})

const PRIMARY_COLOR = '#222226'
const SURFACE_ALPHA = 0.4

const colorByType: Record<ITrackType, string> = {
  frames: '#4f46e5',
  audio: '#0ea5e9',
  text: '#16a34a',
  sticker: '#f97316',
  effect: '#a855f7',
  filter: '#64748b',
}

const filteredTracks = computed(() => {
  if (!props.protocol?.tracks?.length)
    return [] as TrackUnion[]
  if (!props.trackTypes?.length)
    return props.protocol.tracks
  return props.protocol.tracks.filter((track: TrackUnion) => props.trackTypes?.includes(track.trackType))
})

const timelineTracks = computed<TimelineTrack[]>(() => filteredTracks.value.map((track: TrackUnion, index: number) => {
  const accent = colorByType[track.trackType] || PRIMARY_COLOR
  const surface = toAlphaColor(accent, SURFACE_ALPHA)
  return {
    id: track.trackId || `${track.trackType}-${index}`,
    label: track.trackType,
    type: track.trackType,
    color: accent,
    payload: track,
    segments: track.children.map((segment: SegmentUnion) => ({
      id: segment.id,
      start: segment.startTime,
      end: segment.endTime,
      type: segment.segmentType,
      color: surface,
      payload: segment,
    })),
  }
}))

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

function cloneProtocol(source: IVideoProtocol | null | undefined) {
  return source ? JSON.parse(JSON.stringify(source)) as IVideoProtocol : null
}

function getMutableSegments(track: TrackUnion): SegmentUnion[] {
  return track.children as SegmentUnion[]
}

function findTrack(protocol: IVideoProtocol, trackId: string) {
  return protocol.tracks.find((track: TrackUnion) => track.trackId === trackId)
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

function applySegmentPosition(payload: SegmentDragPayload) {
  if (!props.protocol)
    return

  const next = cloneProtocol(props.protocol)
  if (!next)
    return

  const sourceTrack = findTrack(next, payload.track.id)
  const targetTrack = findTrack(next, payload.targetTrackId) ?? sourceTrack
  if (!sourceTrack || !targetTrack)
    return

  const segmentIndex = sourceTrack.children.findIndex((seg: SegmentUnion) => seg.id === payload.segment.id)
  if (segmentIndex < 0)
    return

  const segment = sourceTrack.children[segmentIndex] as SegmentUnion
  const canMoveTrack = segment.segmentType === targetTrack.trackType
  const destination = canMoveTrack ? targetTrack : sourceTrack

  if (destination !== sourceTrack) {
    sourceTrack.children.splice(segmentIndex, 1)
    getMutableSegments(destination).push(segment)
  }

  segment.startTime = payload.startTime
  segment.endTime = payload.endTime
  getMutableSegments(destination).sort((a, b) => a.startTime - b.startTime)

  emit('update:protocol', next)
  emit('segmentDragEnd', { segment, track: destination, protocol: next })
}

function applySegmentResize(payload: SegmentResizePayload) {
  if (!props.protocol)
    return
  const next = cloneProtocol(props.protocol)
  if (!next)
    return

  const track = findTrack(next, payload.track.id)
  if (!track)
    return

  const segment = track.children.find((seg: SegmentUnion) => seg.id === payload.segment.id) as SegmentUnion | undefined
  if (!segment)
    return

  segment.startTime = payload.startTime
  segment.endTime = payload.endTime
  getMutableSegments(track).sort((a, b) => a.startTime - b.startTime)

  emit('update:protocol', next)
  emit('segmentResizeEnd', { segment, track, protocol: next })
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
    @update:current-time="emit('update:currentTime', $event)"
    @update:zoom="emit('update:zoom', $event)"
    @segment-click="handleTimelineSegmentClick"
    @segment-drag-end="applySegmentPosition"
    @segment-resize-end="applySegmentResize"
    @background-click="emitSelection(null)"
  >
    <template #segment="{ layout }">
      <template v-for="segment in [resolveSegment(layout.segment.payload)]" :key="segment?.id || layout.segment.id">
        <div
          v-if="segment"
          class="ve-editor-segment"
          :style="{ '--ve-segment-accent': layout.track.color || PRIMARY_COLOR }"
        >
          <div class="ve-editor-segment__preview">
            <FramesSegment
              v-if="segment.segmentType === 'frames'"
              :segment="segment"
            />
            <SegmentBase
              v-else
              :segment="segment"
              :track-type="layout.track.type || 'unknown'"
              :accent-color="layout.track.color"
            />
          </div>
        </div>
      </template>
    </template>
  </VideoTimeline>
</template>

<style scoped>
:where(.ve-editor-segment) {
  --at-apply: relative flex flex-col gap-1.5 w-full h-full text-[#0f172a];
}

:where(.ve-editor-segment .ve-editor-segment__preview) {
  --at-apply: flex items-stretch w-full min-h-14;
}
</style>
