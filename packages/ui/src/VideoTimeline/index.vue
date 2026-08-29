<script setup lang="ts">
import type {
  SegmentDragPayload,
  SegmentLayout,
  SegmentResizePayload,
  TickLevel,
  TimelineTick,
  TimelineTrack,
} from './types'
import type { SnapResolution } from './snap'
import type { SnapGuide } from './hooks'
import { computed, onBeforeUnmount, onMounted, ref, toRef, useSlots, watch } from 'vue'
import TimelinePlayhead from '../timeline/TimelinePlayhead.vue'
import TimelineRuler from '../timeline/TimelineRuler.vue'
import TimelineToolbar from '../timeline/TimelineToolbar.vue'
import TimelineTracks from '../timeline/TimelineTracks.vue'
import { useDragAndDrop } from './hooks'
import { collectSnapCandidates, quantizeToGrid, resolveSnapCandidates, SNAP_THRESHOLD_PX } from './snap'

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
  showTrackRail?: boolean
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
  showTrackRail: false,
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
  (e: 'add-segment', { track, startTime, endTime, event }: { track: TimelineTrack, startTime: number, endTime?: number, event?: MouseEvent }): void
}>()

const DEFAULT_TRACK_RAIL_WIDTH = 28
const slots = useSlots()
const hasTrackRailSlot = computed(() => props.showTrackRail || Boolean(slots['track-rail']))

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

interface ResizeState {
  layout: SegmentLayout
  edge: 'start' | 'end'
  initialX: number
}

// 使用拖拽 hook
const {
  draggingState,
  dragPreview,
  snapGuides,
  startDrag,
  handleDragMove,
  handleDragEnd,
} = useDragAndDrop({
  tracks: toRef(props, 'tracks'),
  tracksRef,
  trackHeightPx,
  trackGapPx,
  pixelsPerMs,
  disableInteraction: toRef(props, 'disableInteraction'),
  snap: (rawStartMs, durationMs, excludeId) => resolveSnap(rawStartMs, durationMs, { excludeId }),
  onDragStart: (payload) => {
    emit('segmentDragStart', payload)
  },
  onDrag: (payload) => {
    emit('segmentDrag', payload)
  },
  onDragEnd: (payload) => {
    emit('segmentDragEnd', payload)
  },
})

const resizePreview = ref<SegmentResizePayload | null>(null)
/** Snap guide times matched while resizing (drags keep theirs in the hook). */
const resizeGuideTimes = ref<number[]>([])
const dragPreviewPayload = computed(() => dragPreview.value)
const resizePreviewPayload = computed(() => resizePreview.value)
const resizingState = ref<ResizeState | null>(null)
const draggingPlayhead = ref(false)
const isMouseDownOnTimeline = ref(false)
const justFinishedDragging = ref(false)

/** Guide lines currently visible: drag guides, else resize guides. */
const activeSnapGuides = computed<SnapGuide[]>(() => {
  if (dragPreview.value)
    return snapGuides.value
  if (!resizingState.value)
    return []
  return resizeGuideTimes.value.map(timeMs => ({
    time: timeMs,
    left: timeMs * pixelsPerMs.value,
  }))
})

// Calculate dragged segment position offset
const draggingSegmentLayout = computed(() => {
  if (!dragPreview.value)
    return null

  const payload = dragPreview.value

  // Find original layout info
  const trackLayout = segmentLayouts.value.find(t => t.track.id === payload.track.id)
  const layout = trackLayout?.segments.find(s => s.segment.id === payload.segment.id)

  if (!layout)
    return null

  const left = Math.max(0, layout.left + payload.mouseDeltaX)

  // Calculate vertical position - use raw mouse Y offset to let segment fully follow mouse
  const originalTop = rulerHeightPx.value + payload.trackIndex * (trackHeightPx.value + trackGapPx.value) + trackGapPx.value
  const top = originalTop + payload.mouseDeltaY

  return {
    ...layout,
    left,
    top,
  }
})

// Calculate placeholder position
const placeholderTop = computed(() => {
  if (!dragPreview.value)
    return 0

  const payload = dragPreview.value
  if (payload.isNewTrack) {
    // New track - placeholder shows where new track will be created
    if (payload.newTrackInsertIndex === 0) {
      // Before first track - show below ruler
      return rulerHeightPx.value + trackGapPx.value
    }
    // Other positions - show at corresponding track index position
    return rulerHeightPx.value + payload.targetTrackIndex * (trackHeightPx.value + trackGapPx.value) + trackGapPx.value
  }
  // Not creating new track - normal calculation
  return rulerHeightPx.value + payload.targetTrackIndex * (trackHeightPx.value + trackGapPx.value) + trackGapPx.value
})

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
  const desired = props.currentTime * pixelsPerMs.value + getTimelineTrackRailWidth() - halfWidth
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

/** Grid step used for plain quantization (explicit snapStep, else one frame). */
const gridStepMs = computed(() => {
  const customStep = props.snapStep
  return customStep && customStep > 0 ? customStep : frameDurationMs.value
})

/** Grid-only snap: used by the playhead, which must not magnet to itself. */
function snap(time: number) {
  return quantizeToGrid(time, gridStepMs.value)
}

/**
 * Edge snapping: tests both edges of the moved range against the grid, every
 * other segment boundary, the playhead and the timeline origin, within a
 * pixel-based threshold. Falls back to grid quantization when nothing matches.
 */
function resolveSnap(
  rawStartMs: number,
  durationMs: number,
  opts: { excludeId?: string } = {},
): SnapResolution {
  const thresholdMs = SNAP_THRESHOLD_PX / Math.max(pixelsPerMs.value, 0.0001)
  const candidates = collectSnapCandidates({
    tracks: props.tracks,
    rawStart: rawStartMs,
    durationMs,
    gridStepMs: gridStepMs.value,
    playheadMs: props.currentTime,
    excludeId: opts.excludeId,
  })
  const resolved = resolveSnapCandidates(candidates, rawStartMs, durationMs, thresholdMs)
  if (resolved)
    return resolved
  return { time: snap(rawStartMs), guideTimes: [] }
}

function handleBackgroundClick(event: MouseEvent) {
  if (!contentRef.value)
    return

  // 如果刚刚完成拖拽,不触发背景点击
  if (justFinishedDragging.value) {
    justFinishedDragging.value = false
    return
  }

  const x = resolveTimelineClientX(event.clientX)
  const nextTime = snap(x / Math.max(pixelsPerMs.value, 0.0001))
  emit('update:currentTime', nextTime)
  emit('backgroundClick', event)
  isMouseDownOnTimeline.value = true
}

function getTimelineTrackRailWidth() {
  if (!hasTrackRailSlot.value)
    return 0

  const content = contentRef.value
  if (!content)
    return DEFAULT_TRACK_RAIL_WIDTH

  const value = Number.parseFloat(getComputedStyle(content).getPropertyValue('--ve-track-rail-width'))
  return Number.isFinite(value) ? Math.max(value, 0) : DEFAULT_TRACK_RAIL_WIDTH
}

function resolveTimelineClientX(clientX: number) {
  if (!contentRef.value)
    return 0

  const rect = contentRef.value.getBoundingClientRect()
  return Math.max(0, clientX - rect.left - getTimelineTrackRailWidth())
}

function formatTimelineX(left: number) {
  if (!hasTrackRailSlot.value)
    return `${left}px`

  return `calc(${left}px + var(--ve-track-rail-width, ${DEFAULT_TRACK_RAIL_WIDTH}px))`
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
  const relativeX = resolveTimelineClientX(clientX)
  const nextTime = snap(relativeX / Math.max(pixelsPerMs.value, 0.0001))
  emit('update:currentTime', nextTime)
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
  resizeGuideTimes.value = []
  emit('segmentResizeStart', payload)
}

function emitResizePreview(state: ResizeState, clientX: number, trigger: 'drag' | 'end') {
  const { layout, edge, initialX } = state
  const deltaX = clientX - initialX
  const deltaMs = deltaX / Math.max(pixelsPerMs.value, 0.0001)
  const minDuration = Math.max(props.minSegmentDuration, 10)

  let nextStart = layout.segment.start
  let nextEnd = layout.segment.end
  if (edge === 'start') {
    // A resize moves a single edge, so the snapped range has no duration.
    const resolved = resolveSnap(Math.max(0, layout.segment.start + deltaMs), 0, { excludeId: layout.segment.id })
    resizeGuideTimes.value = resolved.guideTimes
    nextStart = resolved.time
    if (layout.segment.end - nextStart < minDuration)
      nextStart = layout.segment.end - minDuration
  }
  else {
    const resolved = resolveSnap(
      Math.max(layout.segment.start + minDuration, layout.segment.end + deltaMs),
      0,
      { excludeId: layout.segment.id },
    )
    resizeGuideTimes.value = resolved.guideTimes
    nextEnd = Math.max(layout.segment.start + minDuration, resolved.time)

    const { sourceDurationMs, fromTime: fromTimeMs } = layout.segment
    if (
      typeof sourceDurationMs === 'number'
      && Number.isFinite(sourceDurationMs)
      && sourceDurationMs > 0
      && typeof fromTimeMs === 'number'
      && Number.isFinite(fromTimeMs)
      && fromTimeMs >= 0
    ) {
      const maxDuration = Math.max(0, sourceDurationMs - fromTimeMs)
      const maxEnd = nextStart + maxDuration
      if (nextEnd > maxEnd)
        nextEnd = maxEnd
    }
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

function handleAddSegment({ track, startTime, endTime, event }: { track: TimelineTrack, startTime: number, endTime?: number, event?: MouseEvent }) {
  const trackLayout = segmentLayouts.value.find(t => t.track.id === track.id)
  if (trackLayout)
    emit('add-segment', { track: trackLayout.track, startTime, endTime, event })
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

  // 使用 hook 中的拖拽处理
  handleDragMove(event)
}

function handleGlobalMouseUp(event: MouseEvent) {
  if (draggingPlayhead.value) {
    draggingPlayhead.value = false
    isMouseDownOnTimeline.value = false
    seekByClientX(event.clientX)
    justFinishedDragging.value = true
    return
  }

  if (resizingState.value) {
    emitResizePreview(resizingState.value, event.clientX, 'end')
    resizingState.value = null
    resizePreview.value = null
    resizeGuideTimes.value = []
    isMouseDownOnTimeline.value = false
    justFinishedDragging.value = true
    return
  }

  // 处理拖拽结束或点击
  if (draggingState.value) {
    if (!draggingState.value.moved) {
      const { layout } = draggingState.value
      handleSegmentClick(layout, event)
    }
    else {
      // 如果进行了拖拽,标记为刚完成拖拽,防止触发背景点击
      justFinishedDragging.value = true
    }
  }

  // 使用 hook 中的拖拽结束处理
  handleDragEnd(event)

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
  <div
    class="ve-timeline"
    :class="{ 've-timeline--interacting': dragPreview || resizePreview || draggingPlayhead }"
  >
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

    <div class="ve-timeline__body">
      <div
        ref="viewportRef"
        class="ve-timeline__viewport"
        @click="handleBackgroundClick"
      >
        <div
          ref="contentRef"
          class="ve-timeline__content"
          :class="{ 've-timeline__content--with-track-rail': hasTrackRailSlot }"
          :style="{ width: `${contentWidthPx}px` }"
        >
          <div class="ve-timeline__ruler-layer">
            <slot name="ruler" :ticks="ticks" :pixels-per-ms="pixelsPerMs">
              <TimelineRuler :ticks="ticks" :style="{ height: `${rulerHeightPx}px` }" />
            </slot>
          </div>

          <slot name="playhead" :left="playheadLeft" :current-time="currentTime">
            <TimelinePlayhead
              :left="formatTimelineX(playheadLeft)"
              @drag-start="handlePlayheadMouseDown"
            />
          </slot>

          <div ref="tracksRef">
            <TimelineTracks
              :tracks="segmentLayouts"
              :track-height="trackHeightPx"
              :track-gap="trackGapPx"
              :selected-segment-id="props.selectedSegmentId"
              :show-track-rail="hasTrackRailSlot"
              :drag-preview="dragPreview"
              :resize-preview="resizePreview"
              @segment-click="handleSegmentClick"
              @segment-mousedown="startDrag"
              @resize-start="startResize"
              @add-segment="handleAddSegment"
            >
              <template #track-rail="slotProps">
                <slot name="track-rail" v-bind="slotProps" />
              </template>

              <!-- Pass through the per-track overlay slot (track controls) -->
              <template v-if="$slots.track" #track="slotProps">
                <slot name="track" v-bind="slotProps" />
              </template>

              <template #segment="{ layout, segment, track, isSelected }">
                <slot
                  name="segment"
                  :layout="layout"
                  :segment="segment"
                  :track="track"
                  :is-selected="isSelected"
                >
                  <div class="ve-segment__content">
                    <div class="ve-segment__title">
                      {{ segment.type || 'segment' }}
                    </div>
                    <div class="ve-segment__time">
                      {{ formatTime(segment.start) }} - {{ formatTime(segment.end) }}
                    </div>
                  </div>
                </slot>
              </template>
            </TimelineTracks>
          </div>

          <!-- 轨道之上的自定义覆盖层（如转场手柄），与拖拽预览共用坐标系 -->
          <div
            class="ve-timeline__overlay-layer"
            :class="{ 've-timeline__overlay-layer--with-track-rail': hasTrackRailSlot }"
          >
            <slot
              name="overlay"
              :track-layouts="segmentLayouts"
              :pixels-per-ms="pixelsPerMs"
              :ruler-height="rulerHeightPx"
              :track-height="trackHeightPx"
              :track-gap="trackGapPx"
            />
          </div>

        <!-- 拖拽中的 segment (提升到轨道外避免被 overflow 裁剪) -->
        <template v-if="draggingSegmentLayout">
          <div
            class="ve-segment ve-segment--dragging"
            :style="{
              left: formatTimelineX(draggingSegmentLayout.left),
              width: `${draggingSegmentLayout.width}px`,
              top: `${draggingSegmentLayout.top}px`,
              height: `${trackHeightPx}px`,
              backgroundColor: draggingSegmentLayout.segment.color || 'var(--ve-primary)',
            }"
          >
            <slot
              name="segment"
              :layout="draggingSegmentLayout"
              :segment="draggingSegmentLayout.segment"
              :track="draggingSegmentLayout.track"
              :is-selected="draggingSegmentLayout.isSelected"
            >
              <div class="ve-segment__content">
                <div class="ve-segment__title">
                  {{ draggingSegmentLayout.segment.type || 'segment' }}
                </div>
                <div class="ve-segment__time">
                  {{ formatTime(draggingSegmentLayout.segment.start) }} - {{ formatTime(draggingSegmentLayout.segment.end) }}
                </div>
              </div>
            </slot>
          </div>
        </template>

        <!-- Placeholder for final drop position (only show when not creating new track) -->
        <template v-if="dragPreviewPayload && !dragPreviewPayload.isNewTrack">
          <div
            class="ve-segment ve-segment--placeholder"
            :style="{
              left: formatTimelineX(dragPreviewPayload.startTime * pixelsPerMs),
              width: `${(dragPreviewPayload.endTime - dragPreviewPayload.startTime) * pixelsPerMs}px`,
              top: `${placeholderTop}px`,
              height: `${trackHeightPx}px`,
            }"
          >
            <div
              class="ve-segment--placeholder-inner"
              :style="{
                backgroundColor: dragPreviewPayload.segment.color || 'var(--ve-primary)',
              }"
            />
          </div>
        </template>

        <template v-if="resizePreviewPayload">
          <div
            class="ve-segment ve-segment--preview"
            :style="{
              left: formatTimelineX(resizePreviewPayload.startTime * pixelsPerMs),
              width: `${(resizePreviewPayload.endTime - resizePreviewPayload.startTime) * pixelsPerMs}px`,
              top: `${rulerHeightPx + resizePreviewPayload.trackIndex * (trackHeightPx + trackGapPx) + trackGapPx}px`,
              height: `${trackHeightPx}px`,
              backgroundColor: resizePreviewPayload.segment.color || 'var(--ve-primary)',
            }"
          />
        </template>

        <!-- 吸附辅助线 -->
        <template v-if="activeSnapGuides.length">
          <div
            v-for="guide in activeSnapGuides"
            :key="`snap-${guide.time}`"
            class="ve-snap-guide"
            :style="{
              left: formatTimelineX(guide.left),
              top: `${rulerHeightPx}px`,
              height: `calc(100% - ${rulerHeightPx}px)`,
            }"
          />
        </template>

        <!-- 新轨道创建提示 - 蓝色线 -->
        <template v-if="dragPreview && dragPreview.isNewTrack">
          <div
            class="ve-new-track-line"
            :style="{
              top: `${rulerHeightPx + dragPreview.targetTrackIndex * (trackHeightPx + trackGapPx)}px`,
              left: hasTrackRailSlot ? `var(--ve-track-rail-width, ${DEFAULT_TRACK_RAIL_WIDTH}px)` : '0',
              right: '0',
            }"
          />
        </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
:where(.ve-timeline) {
  --ve-primary: #222226;
  --ve-track-rail-width: 28px;
  --ve-content-primary: rgba(0, 0, 0, 0.9);
  --ve-content-secondary: rgba(0, 0, 0, 0.55);
  --ve-content-tertiary: rgba(0, 0, 0, 0.35);
  --ve-content-on-primary: rgba(255, 255, 255, 0.9);
  --ve-surface-elevated: #fff;
  --ve-surface-control-subtle: rgba(0, 0, 0, 0.05);
  --ve-surface-control-muted: rgba(0, 0, 0, 0.08);
  --ve-surface-control-hover: rgba(0, 0, 0, 0.1);
  --ve-border-weak: rgba(0, 0, 0, 0.05);
  --ve-border-subtle: rgba(0, 0, 0, 0.12);
  --ve-selection-background: rgba(90, 90, 255, 0.12);
  --ve-selection-border: #5a5aff;
  --ve-shadow-floating: 0 8px 10px -5px rgba(0, 0, 0, 0.08), 0 6px 30px 5px rgba(0, 0, 0, 0.05);
  color-scheme: light;
  --at-apply: flex flex-col w-full max-w-full min-w-0 rounded-10px h-full;
}

:where(.ve-theme-dark .ve-timeline),
:where(.ve-timeline[data-theme='dark']) {
  --ve-primary: #fff;
  --ve-content-primary: rgba(255, 255, 255, 0.9);
  --ve-content-secondary: rgba(255, 255, 255, 0.55);
  --ve-content-tertiary: rgba(255, 255, 255, 0.35);
  --ve-content-on-primary: rgba(0, 0, 0, 0.9);
  --ve-surface-elevated: #1a1a1a;
  --ve-surface-control-subtle: rgba(255, 255, 255, 0.05);
  --ve-surface-control-muted: rgba(255, 255, 255, 0.08);
  --ve-surface-control-hover: rgba(255, 255, 255, 0.1);
  --ve-border-weak: rgba(255, 255, 255, 0.12);
  --ve-border-subtle: rgba(255, 255, 255, 0.12);
  --ve-selection-background: rgba(90, 90, 255, 0.18);
  color-scheme: dark;
}

:where(.ve-timeline .ve-timeline__body) {
  display: flex;
  flex: 1 1 0%;
  width: 100%;
  min-height: 0;
}

:where(.ve-timeline .ve-timeline__viewport) {
  --at-apply: relative overflow-auto w-full flex-1 min-w-0 min-h-0;
  background: var(--ve-surface-elevated);
}

:where(.ve-timeline .ve-timeline__content) {
  --at-apply: relative min-h-full min-w-full;
}

:where(.ve-timeline .ve-timeline__ruler-layer) {
  position: sticky;
  top: 0;
  z-index: 30;
  width: 100%;
  background: var(--ve-surface-elevated);
}

:where(.ve-timeline .ve-timeline__content--with-track-rail .ve-timeline__ruler-layer) {
  margin-left: var(--ve-track-rail-width);
}

:where(.ve-timeline .ve-timeline__overlay-layer) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

:where(.ve-timeline .ve-timeline__overlay-layer--with-track-rail) {
  left: var(--ve-track-rail-width);
}

:where(.ve-timeline .ve-timeline__overlay-layer > *) {
  pointer-events: auto;
}

/* Dragging segment (VideoTimeline specific) */
:where(.ve-timeline .ve-segment--dragging) {
  --at-apply: absolute z-50 rounded-[4px] cursor-pointer flex items-center overflow-hidden pointer-events-none;
  color: var(--ve-content-primary);
  box-shadow: var(--ve-shadow-floating), inset 0 0 0 1px var(--ve-border-weak);
  transition: none;
}

/* Resize preview (VideoTimeline specific) */
:where(.ve-timeline .ve-segment--preview) {
  --at-apply: absolute z-45 rounded-[4px] pointer-events-none;
  opacity: 0.7;
  box-shadow: var(--ve-shadow-floating), inset 0 0 0 1px var(--ve-border-weak);
  transition: none;
}

/* Segment content for dragging segment */
:where(.ve-timeline .ve-segment__content) {
  --at-apply: flex flex-col gap-1 px-2.5 py-1.5;
}

:where(.ve-timeline .ve-segment__title) {
  --at-apply: text-[12px] font-bold capitalize;
}

:where(.ve-timeline .ve-segment__time) {
  --at-apply: text-[11px] font-mono;
  color: var(--ve-content-secondary);
}

/* Drop placeholder (VideoTimeline specific) */
:where(.ve-timeline .ve-segment--placeholder) {
  --at-apply: absolute pointer-events-none rounded-[4px] z-24;
  background: var(--ve-selection-background);
  border: 1px solid var(--ve-selection-border);
  transition: none;
}

:where(.ve-timeline .ve-segment--placeholder-inner) {
  --at-apply: absolute inset-0 rounded-[2px];
  opacity: 0.2;
}

:where(.ve-timeline .ve-snap-guide) {
  --at-apply: absolute pointer-events-none z-20;
  width: 1px;
  background: var(--ve-primary);
  opacity: 0.7;
}

:where(.ve-timeline .ve-new-track-line) {
  --at-apply: absolute pointer-events-none z-25;
  height: 1px;
  background: var(--ve-primary);
  opacity: 0.8;
}

:where(.ve-timeline--interacting .ve-segment),
:where(.ve-timeline--interacting .ve-track) {
  transition: none !important;
}
</style>
