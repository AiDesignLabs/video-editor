<script setup lang="ts">
import type {
  SegmentDragPayload,
  SegmentLayout,
  SegmentResizePayload,
  TickLevel,
  TimelineTick,
  TimelineTrack,
} from './types'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TimelinePlayhead from '../timeline/TimelinePlayhead.vue'
import TimelineRuler from '../timeline/TimelineRuler.vue'
import TimelineToolbar from '../timeline/TimelineToolbar.vue'

defineOptions({ name: 'VideoTimeline' })

const props = withDefaults(defineProps<{
  tracks: TimelineTrack[]
  currentTime: number
  duration?: number
  zoom?: number
  minZoom?: number
  maxZoom?: number
  snapStep?: number
  trackHeight?: number
  trackGap?: number
  rulerHeight?: number
  minSegmentDuration?: number
  selectedSegmentId?: string | null
  disableInteraction?: boolean
  fps?: number
}>(), {
  minZoom: 0.25,
  maxZoom: 10,
  snapStep: 0,
  trackHeight: 56,
  trackGap: 8,
  rulerHeight: 28,
  minSegmentDuration: 60,
  selectedSegmentId: null,
  disableInteraction: false,
  fps: 30,
})

const emit = defineEmits<{
  (e: 'update:currentTime', value: number): void
  (e: 'update:zoom', value: number): void
  (e: 'segmentClick', layout: SegmentLayout, event: MouseEvent): void
  (e: 'segmentDragStart', payload: SegmentDragPayload): void
  (e: 'segmentDrag', payload: SegmentDragPayload): void
  (e: 'segmentDragEnd', payload: SegmentDragPayload): void
  (e: 'segmentResizeStart', payload: SegmentResizePayload): void
  (e: 'segmentResize', payload: SegmentResizePayload): void
  (e: 'segmentResizeEnd', payload: SegmentResizePayload): void
  (e: 'backgroundClick', event: MouseEvent): void
}>()

const viewportRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const tracksRef = ref<HTMLElement | null>(null)

const viewportWidth = ref(0)
let resizeObserver: ResizeObserver | null = null

const innerZoom = ref(clampZoom(props.zoom ?? props.minZoom))
const initialZoomSet = ref(false)
watch(() => props.zoom, (value) => {
  if (typeof value === 'number')
    innerZoom.value = clampZoom(value)
})
watch(innerZoom, value => emit('update:zoom', value))

const computedDuration = computed(() => {
  if (typeof props.duration === 'number')
    return Math.max(props.duration, 0)
  const maxEndFromTracks = Math.max(
    0,
    ...props.tracks.flatMap(track =>
      track.segments.map(segment => segment.end),
    ),
  )
  return maxEndFromTracks
})

// Keep the visible scale stable when the underlying timeline duration changes
watch(computedDuration, (next, prev) => {
  if (!prev || !next || prev <= 0 || next <= 0)
    return
  if (!initialZoomSet.value || !viewportWidth.value)
    return

  const previousPxPerMs = (viewportWidth.value * innerZoom.value) / prev
  if (!Number.isFinite(previousPxPerMs) || previousPxPerMs <= 0)
    return

  const recalculatedZoom = clampZoom((previousPxPerMs * next) / viewportWidth.value)
  if (Math.abs(recalculatedZoom - innerZoom.value) > 1e-6)
    innerZoom.value = recalculatedZoom
})

const pixelsPerMs = computed(() => {
  const duration = Math.max(computedDuration.value, 1)
  const width = Math.max(viewportWidth.value, 1)
  return (width * innerZoom.value) / duration
})

const contentWidthPx = computed(() => {
  const derived = computedDuration.value * pixelsPerMs.value
  const safeWidth = Number.isFinite(derived) ? Math.max(derived, 0) : 0
  return Math.max(Math.ceil(safeWidth), Math.ceil(viewportWidth.value || 0))
})

const renderedDurationForTicks = computed(() => {
  const pxPerMs = Math.max(pixelsPerMs.value, 0.0001)
  const pxWidth = contentWidthPx.value || viewportWidth.value || 0
  const visibleDuration = pxWidth / pxPerMs
  return Math.max(computedDuration.value, visibleDuration)
})

const playheadLeft = computed(() => props.currentTime * pixelsPerMs.value)

const ticks = computed<TimelineTick[]>(() => buildTicks(renderedDurationForTicks.value, pixelsPerMs.value))
const frameDurationMs = computed(() => 1000 / Math.max(props.fps || 30, 1))

const trackHeightPx = computed(() => props.trackHeight)
const trackGapPx = computed(() => props.trackGap)
const rulerHeightPx = computed(() => props.rulerHeight)

const segmentLayouts = computed(() => props.tracks.map((track, trackIndex) => ({
  track,
  trackIndex,
  segments: track.segments.map((segment, segmentIndex) => {
    const width = Math.max((segment.end - segment.start) * pixelsPerMs.value, 6)
    const left = segment.start * pixelsPerMs.value
    return {
      track,
      trackIndex,
      segment,
      segmentIndex,
      left,
      width,
      isSelected: props.selectedSegmentId === segment.id,
    } as SegmentLayout
  }),
})))

interface DragState {
  layout: SegmentLayout
  initialX: number
  initialY: number
  moved: boolean
}

interface ResizeState {
  layout: SegmentLayout
  edge: 'start' | 'end'
  initialX: number
}

const dragPreview = ref<SegmentDragPayload | null>(null)
const resizePreview = ref<SegmentResizePayload | null>(null)
const dragPreviewPayload = computed(() => dragPreview.value)
const resizePreviewPayload = computed(() => resizePreview.value)
const draggingState = ref<DragState | null>(null)
const resizingState = ref<ResizeState | null>(null)
const draggingPlayhead = ref(false)
const isMouseDownOnTimeline = ref(false)

onMounted(() => {
  if (viewportRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      viewportWidth.value = entry?.contentRect.width || viewportRef.value?.clientWidth || 0
    })
    resizeObserver.observe(viewportRef.value)
    viewportWidth.value = viewportRef.value.clientWidth || 0
  }

  window.addEventListener('mousemove', handleGlobalMouseMove)
  window.addEventListener('mouseup', handleGlobalMouseUp)

  applyInitialZoom()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('mousemove', handleGlobalMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
})

watch(innerZoom, () => {
  centerViewportOnCurrentTime()
})

function centerViewportOnCurrentTime() {
  const viewport = viewportRef.value
  if (!viewport)
    return
  const halfWidth = viewport.clientWidth / 2
  const desired = props.currentTime * pixelsPerMs.value - halfWidth
  viewport.scrollLeft = Math.max(0, desired)
}

function clampZoom(value: number) {
  if (!Number.isFinite(value))
    return props.minZoom
  return Math.min(Math.max(value, props.minZoom), props.maxZoom)
}

function applyInitialZoom() {
  if (initialZoomSet.value)
    return
  if (props.zoom !== undefined) {
    initialZoomSet.value = true
    return
  }
  if (!viewportWidth.value || computedDuration.value <= 0)
    return
  const target = clampZoom(1 / 3)
  innerZoom.value = target
  initialZoomSet.value = true
}

function formatTime(ms: number) {
  const safeMs = Math.max(ms, 0)
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  const milliseconds = Math.floor((safeMs % 1000) / 10).toString().padStart(2, '0')
  return `${minutes}:${seconds}.${milliseconds}`
}

function formatSecondsLabel(ms: number) {
  const safeMs = Math.max(ms, 0)
  const totalSeconds = Math.floor(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function buildTicks(duration: number, pxPerMs: number): TimelineTick[] {
  if (!duration || !pxPerMs)
    return []

  const level = selectTickLevel(pxPerMs, props.fps || 30)
  const majorEvery = Math.max(1, Math.round(level.mainMs / level.minorMs))
  const renderDurationMs = Math.max(duration, 1)
  const totalMinor = Math.ceil(renderDurationMs / level.minorMs)
  const ticksList: TimelineTick[] = []
  for (let i = 0; i <= totalMinor; i += 1) {
    const timeMs = Math.min(renderDurationMs, i * level.minorMs)
    const position = timeMs * pxPerMs
    const isMajor = i % majorEvery === 0
    ticksList.push({
      position,
      timeMs,
      isMajor,
      label: isMajor ? formatTickLabel(timeMs, props.fps || 30, level) : undefined,
    })
  }

  return ticksList
}

function snap(time: number) {
  const customStep = props.snapStep
  const step = customStep && customStep > 0 ? customStep : frameDurationMs.value
  return Math.max(Math.round(time / step) * step, 0)
}

function handleBackgroundClick(event: MouseEvent) {
  if (!contentRef.value)
    return
  const rect = contentRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const nextTime = snap(x / Math.max(pixelsPerMs.value, 0.0001))
  emit('update:currentTime', nextTime)
  emit('backgroundClick', event)
  isMouseDownOnTimeline.value = true
}

function handlePlayheadMouseDown(event: MouseEvent) {
  if (props.disableInteraction)
    return
  event.preventDefault()
  draggingPlayhead.value = true
  isMouseDownOnTimeline.value = true
  seekByClientX(event.clientX)
  centerViewportOnCurrentTime()
}

function seekByClientX(clientX: number) {
  if (!contentRef.value)
    return
  const rect = contentRef.value.getBoundingClientRect()
  const relativeX = clientX - rect.left
  const nextTime = snap(relativeX / Math.max(pixelsPerMs.value, 0.0001))
  emit('update:currentTime', nextTime)
}

function resolveTrackIndexFromClientY(clientY: number) {
  if (!tracksRef.value)
    return -1
  if (!props.tracks.length)
    return -1
  const rect = tracksRef.value.getBoundingClientRect()
  const relativeY = clientY - rect.top
  const step = trackHeightPx.value + trackGapPx.value
  if (relativeY < 0)
    return -1
  return Math.min(
    props.tracks.length - 1,
    Math.max(0, Math.floor(relativeY / step)),
  )
}

function startDrag(layout: SegmentLayout, event: MouseEvent) {
  if (props.disableInteraction)
    return
  draggingState.value = {
    layout,
    initialX: event.clientX,
    initialY: event.clientY,
    moved: false,
  }
}

function startResize(layout: SegmentLayout, edge: 'start' | 'end', event: MouseEvent) {
  if (props.disableInteraction)
    return
  event.stopPropagation()
  event.preventDefault()
  resizingState.value = {
    layout,
    edge,
    initialX: event.clientX,
  }
  const payload: SegmentResizePayload = {
    segment: layout.segment,
    track: layout.track,
    trackIndex: layout.trackIndex,
    segmentIndex: layout.segmentIndex,
    startTime: layout.segment.start,
    endTime: layout.segment.end,
    edge,
  }
  resizePreview.value = payload
  emit('segmentResizeStart', payload)
}

function emitDragPreview(state: DragState, clientX: number, clientY: number, trigger: 'drag' | 'end') {
  const { layout, initialX, initialY } = state
  const deltaX = clientX - initialX
  const deltaY = clientY - initialY
  const movedEnough = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2
  if (!state.moved && movedEnough) {
    state.moved = true
    const payload: SegmentDragPayload = {
      segment: layout.segment,
      track: layout.track,
      trackIndex: layout.trackIndex,
      segmentIndex: layout.segmentIndex,
      startTime: layout.segment.start,
      endTime: layout.segment.end,
      targetTrackIndex: layout.trackIndex,
      targetTrackId: layout.track.id,
    }
    emit('segmentDragStart', payload)
  }

  const duration = layout.segment.end - layout.segment.start
  const rawIndex = resolveTrackIndexFromClientY(clientY)
  const targetTrackIndex = rawIndex >= 0 ? rawIndex : layout.trackIndex
  const targetTrack = props.tracks[targetTrackIndex] ?? layout.track
  const startTime = snap(layout.segment.start + deltaX / Math.max(pixelsPerMs.value, 0.0001))
  const nextStart = Math.max(0, startTime)
  const nextEnd = nextStart + duration
  const payload: SegmentDragPayload = {
    segment: layout.segment,
    track: layout.track,
    trackIndex: layout.trackIndex,
    segmentIndex: layout.segmentIndex,
    startTime: nextStart,
    endTime: nextEnd,
    targetTrackIndex,
    targetTrackId: targetTrack?.id ?? layout.track.id,
  }
  dragPreview.value = payload

  if (!state.moved)
    return

  if (trigger === 'drag')
    emit('segmentDrag', payload)
  else if (trigger === 'end')
    emit('segmentDragEnd', payload)
}

function emitResizePreview(state: ResizeState, clientX: number, trigger: 'drag' | 'end') {
  const { layout, edge, initialX } = state
  const deltaX = clientX - initialX
  const deltaMs = deltaX / Math.max(pixelsPerMs.value, 0.0001)
  const minDuration = Math.max(props.minSegmentDuration, 10)

  let nextStart = layout.segment.start
  let nextEnd = layout.segment.end
  if (edge === 'start') {
    nextStart = snap(Math.max(0, layout.segment.start + deltaMs))
    if (layout.segment.end - nextStart < minDuration)
      nextStart = layout.segment.end - minDuration
  }
  else {
    nextEnd = snap(Math.max(layout.segment.start + minDuration, layout.segment.end + deltaMs))
  }

  const payload: SegmentResizePayload = {
    segment: layout.segment,
    track: layout.track,
    trackIndex: layout.trackIndex,
    segmentIndex: layout.segmentIndex,
    startTime: nextStart,
    endTime: nextEnd,
    edge,
  }
  resizePreview.value = payload

  if (trigger === 'drag')
    emit('segmentResize', payload)
  else if (trigger === 'end')
    emit('segmentResizeEnd', payload)
}

function handleSegmentClick(layout: SegmentLayout, event: MouseEvent) {
  if (draggingState.value?.layout.segment.id === layout.segment.id && draggingState.value.moved)
    return
  emit('segmentClick', layout, event)
}

function handleGlobalMouseMove(event: MouseEvent) {
  if (draggingPlayhead.value) {
    seekByClientX(event.clientX)
    return
  }

  if (resizingState.value) {
    emitResizePreview(resizingState.value, event.clientX, 'drag')
    return
  }

  if (draggingState.value) {
    emitDragPreview(draggingState.value, event.clientX, event.clientY, 'drag')
  }
}

function handleGlobalMouseUp(event: MouseEvent) {
  if (draggingPlayhead.value) {
    draggingPlayhead.value = false
    isMouseDownOnTimeline.value = false
    seekByClientX(event.clientX)
  }

  if (resizingState.value) {
    emitResizePreview(resizingState.value, event.clientX, 'end')
    resizingState.value = null
    resizePreview.value = null
    isMouseDownOnTimeline.value = false
    return
  }

  if (draggingState.value) {
    if (draggingState.value.moved) {
      emitDragPreview(draggingState.value, event.clientX, event.clientY, 'end')
    }
    else {
      const { layout } = draggingState.value
      handleSegmentClick(layout, event)
    }
    draggingState.value = null
    dragPreview.value = null
  }

  isMouseDownOnTimeline.value = false
}

function zoomIn() {
  innerZoom.value = clampZoom(innerZoom.value * 1.25)
}

function zoomOut() {
  innerZoom.value = clampZoom(innerZoom.value / 1.25)
}

const TICK_TARGET_SPACING_PX = 120
const TICK_MIN_SPACING_PX = 10

function selectTickLevel(pixelsPerMsValue: number, framesPerSecond: number) {
  const fpsValue = Number.isFinite(framesPerSecond) && framesPerSecond > 0 ? framesPerSecond : 30
  const frameMs = 1000 / fpsValue
  const pxPerFrame = pixelsPerMsValue * frameMs

  const timeLevels = buildTimeTickLevels(frameMs)
  const frameLevels = buildFrameTickLevels(frameMs)
  const candidateLevels = pxPerFrame >= TICK_MIN_SPACING_PX ? [...frameLevels, ...timeLevels] : timeLevels

  let best: TickLevel | null = null
  let bestDiff = Infinity

  for (const level of candidateLevels) {
    const spacingPx = level.mainMs * pixelsPerMsValue
    if (spacingPx < TICK_MIN_SPACING_PX)
      continue
    const diff = Math.abs(spacingPx - TICK_TARGET_SPACING_PX)
    if (diff < bestDiff) {
      best = level
      bestDiff = diff
    }
  }

  return best || candidateLevels[candidateLevels.length - 1]! || frameLevels[frameLevels.length - 1]!
}

function buildTimeTickLevels(frameMs: number): TickLevel[] {
  const baseSeconds = [600, 300, 180, 120, 60, 30, 20, 15, 10, 5, 3, 2, 1]
  return baseSeconds.map((seconds) => {
    const mainMs = seconds * 1000
    return {
      mainMs,
      minorMs: Math.max(mainMs / 10, frameMs),
      mode: 'time',
      label: 'time',
    }
  })
}

function buildFrameTickLevels(frameMs: number): TickLevel[] {
  return [
    {
      mainMs: Math.max(frameMs * 2, 1),
      minorMs: Math.max(frameMs, 1),
      mode: 'frame',
      label: 'frame',
    },
    {
      mainMs: Math.max(frameMs * 10, 1),
      minorMs: Math.max(frameMs * 2, 1),
      mode: 'frame',
      label: 'frame',
    },
    {
      mainMs: 1000,
      minorMs: Math.max(frameMs * 10, 1),
      mode: 'frame',
      label: 'frame',
    },
  ]
}

function formatTickLabel(ms: number, framesPerSecond: number, level: TickLevel) {
  if (level.label === 'frame') {
    const fpsValue = Number.isFinite(framesPerSecond) && framesPerSecond > 0 ? framesPerSecond : 30
    const frameMs = 1000 / fpsValue
    const frameIndex = Math.round(ms / frameMs)
    const frameRemainder = frameIndex % fpsValue
    if (frameRemainder === 0)
      return formatSecondsLabel(ms)
    return `${frameRemainder}f`
  }
  return formatSecondsLabel(ms)
}
</script>

<template>
  <div class="ve-timeline">
    <slot
      name="toolbar"
      :zoom="innerZoom"
      :can-zoom-in="innerZoom < maxZoom"
      :can-zoom-out="innerZoom > minZoom"
      :zoom-in="zoomIn"
      :zoom-out="zoomOut"
      :current-time="currentTime"
      :duration="computedDuration"
      :format-time="formatTime"
    >
      <TimelineToolbar
        :zoom="innerZoom"
        :min-zoom="minZoom"
        :max-zoom="maxZoom"
        :current-time="currentTime"
        :duration="computedDuration"
        :format-time="formatTime"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
      />
    </slot>

    <div
      ref="viewportRef"
      class="ve-timeline__viewport"
      @click="handleBackgroundClick"
    >
      <div
        ref="contentRef"
        class="ve-timeline__content"
        :style="{ width: `${contentWidthPx}px` }"
      >
        <slot name="ruler" :ticks="ticks" :pixels-per-ms="pixelsPerMs">
          <TimelineRuler :ticks="ticks" :style="{ height: `${rulerHeightPx}px` }" />
        </slot>

        <slot name="playhead" :left="playheadLeft" :current-time="currentTime">
          <TimelinePlayhead
            class="top-0"
            :left="playheadLeft"
            @drag-start="handlePlayheadMouseDown"
          />
        </slot>

        <div
          ref="tracksRef"
          class="ve-timeline__tracks"
          :style="{ gap: `${trackGapPx}px`, paddingTop: `${trackGapPx}px` }"
        >
          <div
            v-for="trackLayout in segmentLayouts"
            :key="trackLayout.track.id"
            class="ve-track"
            :style="{ height: `${trackHeightPx}px` }"
          >
            <slot
              name="track"
              :track="trackLayout.track"
              :index="trackLayout.trackIndex"
              :segments="trackLayout.segments"
              :pixels-per-ms="pixelsPerMs"
              :height="trackHeightPx"
            >
              <div class="ve-track__body">
                <div
                  v-for="layout in trackLayout.segments"
                  :key="layout.segment.id"
                  class="ve-segment"
                  :class="{
                    've-segment--selected': layout.isSelected,
                    've-segment--dragging': dragPreview?.segment.id === layout.segment.id,
                  }"
                  :style="{
                    left: `${layout.left}px`,
                    width: `${layout.width}px`,
                    backgroundColor: layout.segment.color || trackLayout.track.color || '#4f46e5',
                  }"
                  @mousedown.prevent="startDrag(layout, $event)"
                  @click.stop="handleSegmentClick(layout, $event)"
                >
                  <slot
                    name="segment"
                    :layout="layout"
                    :segment="layout.segment"
                    :track="layout.track"
                    :is-selected="layout.isSelected"
                  >
                    <div class="ve-segment__content">
                      <div class="ve-segment__title">
                        {{ layout.segment.type || 'segment' }}
                      </div>
                      <div class="ve-segment__time">
                        {{ formatTime(layout.segment.start) }} - {{ formatTime(layout.segment.end) }}
                      </div>
                    </div>
                  </slot>

                  <!-- Selection border and handles -->
                  <div
                    v-if="layout.isSelected"
                    class="ve-segment__selection"
                  >
                    <!-- Left handle -->
                    <div
                      class="ve-segment__handle ve-segment__handle--left"
                      @mousedown.stop="startResize(layout, 'start', $event)"
                    >
                      <div class="ve-segment__handle-dots">
                        <div class="ve-segment__handle-dot" />
                        <div class="ve-segment__handle-dot" />
                        <div class="ve-segment__handle-dot" />
                        <div class="ve-segment__handle-dot" />
                      </div>
                    </div>
                    <!-- Right handle -->
                    <div
                      class="ve-segment__handle ve-segment__handle--right"
                      @mousedown.stop="startResize(layout, 'end', $event)"
                    >
                      <div class="ve-segment__handle-dots">
                        <div class="ve-segment__handle-dot" />
                        <div class="ve-segment__handle-dot" />
                        <div class="ve-segment__handle-dot" />
                        <div class="ve-segment__handle-dot" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </slot>
          </div>
        </div>

        <template v-if="dragPreviewPayload">
          <div
            class="ve-segment ve-segment--preview"
            :style="{
              left: `${dragPreviewPayload.startTime * pixelsPerMs}px`,
              width: `${(dragPreviewPayload.endTime - dragPreviewPayload.startTime) * pixelsPerMs}px`,
              top: `${rulerHeightPx + dragPreviewPayload.targetTrackIndex * (trackHeightPx + trackGapPx) + trackGapPx}px`,
              height: `${trackHeightPx}px`,
              backgroundColor: dragPreviewPayload.segment.color || '#3730a3',
            }"
          />
        </template>

        <template v-if="resizePreviewPayload">
          <div
            class="ve-segment ve-segment--preview"
            :style="{
              left: `${resizePreviewPayload.startTime * pixelsPerMs}px`,
              width: `${(resizePreviewPayload.endTime - resizePreviewPayload.startTime) * pixelsPerMs}px`,
              top: `${rulerHeightPx + resizePreviewPayload.trackIndex * (trackHeightPx + trackGapPx) + trackGapPx}px`,
              height: `${trackHeightPx}px`,
              backgroundColor: resizePreviewPayload.segment.color || '#3730a3',
            }"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
:where(.ve-timeline) {
  --ve-primary: #222226;
  --at-apply: flex flex-col w-full max-w-full min-w-0 border border-[#e5e7eb] rounded-10px;
}

:where(.ve-timeline .ve-timeline__viewport) {
  --at-apply: relative overflow-x-auto overflow-y-hidden w-full h-340px bg-white;
}

:where(.ve-timeline .ve-timeline__content) {
  --at-apply: relative min-h-full min-w-full;
}

:where(.ve-timeline .ve-timeline__tracks) {
  --at-apply: relative z-1 pb-3 flex flex-col gap-2px h-full;
}

:where(.ve-timeline .ve-track) {
  --at-apply: relative bg-[#f8fafc] overflow-hidden;
}

:where(.ve-timeline .ve-track__body) {
  --at-apply: relative h-full;
}

:where(.ve-timeline .ve-segment) {
  --at-apply: absolute top-0 bottom-0 rounded-[4px] text-[#0f172a] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] cursor-pointer flex items-center overflow-hidden transition-[box-shadow,transform] duration-150;
}

:where(.ve-timeline .ve-segment--selected) {
  --at-apply: shadow-[0_0_0_2px_var(--ve-primary),inset_0_0_0_1px_rgba(255,255,255,0.45)];
}

:where(.ve-timeline .ve-segment--dragging) {
  --at-apply: opacity-50;
}

:where(.ve-timeline .ve-segment__content) {
  --at-apply: flex flex-col gap-1;
}

:where(.ve-timeline .ve-segment__title) {
  --at-apply: text-[12px] font-bold capitalize;
}

:where(.ve-timeline .ve-segment__time) {
  --at-apply: text-[11px] text-[rgba(15,23,42,0.8)] font-mono;
}

:where(.ve-timeline .ve-segment__selection) {
  --at-apply: absolute bottom-0 left-0 right-0 top-0 pointer-events-none z-10;
}

:where(.ve-timeline .ve-segment__handle) {
  --at-apply: absolute h-full w-1 bg-[var(--ve-primary)] cursor-ew-resize pointer-events-auto top-50% translate-y--50%;
  border: 2px solid var(--ve-primary);
}

:where(.ve-timeline .ve-segment__handle--left) {
  --at-apply: left-0 top-0 translate-x--50% rounded-l-1;
}

:where(.ve-timeline .ve-segment__handle--right) {
  --at-apply: right-0 top-0 translate-x-50% rounded-r-1;
}

:where(.ve-timeline .ve-segment__handle-dots) {
  --at-apply: absolute left-0 top-50% translate-x--50% translate-y--50% flex flex-col items-center gap-0.5 w-1;
  justify-content: center;
}

:where(.ve-timeline .ve-segment__handle-dot) {
  --at-apply: rounded-full bg-white;
  width: 1px;
  height: 1px;
}

:where(.ve-timeline .ve-segment--preview) {
  --at-apply: absolute opacity-35 pointer-events-none rounded-[4px] shadow-[0_0_0_2px_rgba(34,34,38,0.5)];
}
</style>
