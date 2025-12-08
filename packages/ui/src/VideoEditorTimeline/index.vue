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

const colorByType: Record<ITrackType, string> = {
  frames: '#4f46e5',
  audio: '#0ea5e9',
  text: '#16a34a',
  image: '#f97316',
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
  const color = colorByType[track.trackType] || '#4f46e5'
  return {
    id: track.trackId || `${track.trackType}-${index}`,
    label: track.trackType,
    type: track.trackType,
    color,
    payload: track,
    segments: track.children.map((segment: SegmentUnion) => ({
      id: segment.id,
      start: segment.startTime,
      end: segment.endTime,
      type: segment.segmentType,
      color,
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
  const segment = layout.segment.payload as SegmentUnion | undefined
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
  >
    <template #segment="{ layout }">
      <div class="ve-editor-segment">
        <div class="ve-editor-segment__title">
          {{ layout.segment.type || layout.track.type }}
        </div>
        <div class="ve-editor-segment__time">
          {{ (layout.segment.start / 1000).toFixed(2) }}s - {{ (layout.segment.end / 1000).toFixed(2) }}s
        </div>
      </div>
    </template>
  </VideoTimeline>
</template>

<style scoped>
.ve-editor-segment {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ve-editor-segment__title {
  font-weight: 700;
  font-size: 12px;
  text-transform: capitalize;
}

.ve-editor-segment__time {
  font-size: 11px;
  color: rgba(15, 23, 42, 0.8);
  font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}
</style>
