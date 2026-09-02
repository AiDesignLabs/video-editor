<script setup lang="ts">
import type { SegmentLayout, SegmentResizePayload, TimelineTrack } from '../VideoTimeline/types'
import { computed } from 'vue'
import { resolveResizePreviewGeometry } from '../VideoTimeline/resize'
import { intersectsTimelineRenderWindow } from '../VideoTimeline/virtualization'

defineOptions({ name: 'TimelineTracks' })

const props = defineProps<{
  tracks: TrackLayout[]
  trackHeight: number
  /** Per-row heights; falls back to `trackHeight` when a row is missing. */
  trackHeights?: number[]
  trackGap: number
  selectedSegmentId?: string | null
  showTrackRail?: boolean
  dragPreview?: {
    segment: { id: string }
  } | null
  resizePreview?: Pick<SegmentResizePayload, 'segment' | 'startTime' | 'endTime'> | null
  visibleStartPx: number
  visibleEndPx: number
}>()

const emit = defineEmits<{
  segmentClick: [layout: SegmentLayout, event: MouseEvent]
  segmentMousedown: [layout: SegmentLayout, event: MouseEvent]
  resizeStart: [layout: SegmentLayout, edge: 'start' | 'end', event: MouseEvent]
  addSegment: [{ track: TrackLayout['track'], startTime: number, endTime?: number, event?: MouseEvent }]
}>()

interface TrackLayout {
  track: TimelineTrack
  trackIndex: number
  segments: SegmentLayout[]
}

/** Rows may differ in height (frames 56 / audio 48), so never assume a uniform row. */
function resolveTrackHeight(index: number) {
  const height = props.trackHeights?.[index]
  return typeof height === 'number' && height > 0 ? height : props.trackHeight
}

function handleSegmentClick(layout: SegmentLayout, event: MouseEvent) {
  emit('segmentClick', layout, event)
}

function handleSegmentMouseDown(layout: SegmentLayout, event: MouseEvent) {
  emit('segmentMousedown', layout, event)
}

function handleResizeStart(layout: SegmentLayout, edge: 'start' | 'end', event: MouseEvent) {
  emit('resizeStart', layout, edge, event)
}

function handleAddAt(track: TrackLayout['track'], startTime: number, endTime?: number, event?: MouseEvent) {
  emit('addSegment', { track, startTime, endTime, event })
}

function segmentGeometry(layout: SegmentLayout) {
  return resolveResizePreviewGeometry(layout, props.resizePreview)
}

function isActiveSegment(layout: SegmentLayout) {
  const id = layout.segment.id
  return props.dragPreview?.segment.id === id || props.resizePreview?.segment.id === id
}

function getRenderedSegments(trackLayout: TrackLayout) {
  const renderWindow = { startPx: props.visibleStartPx, endPx: props.visibleEndPx }
  return trackLayout.segments.filter((layout) => {
    if (isActiveSegment(layout))
      return true
    const geometry = segmentGeometry(layout)
    return intersectsTimelineRenderWindow(geometry.left, geometry.width, renderWindow)
  })
}

const trackGaps = computed(() => {
  return props.tracks.map((trackLayout) => {
    const gaps = []
    // Gap at the beginning
    if (trackLayout.segments.length > 0 && trackLayout.segments[0].segment.start > 0) {
      const firstSegment = trackLayout.segments[0]
      gaps.push({
        id: `start-${firstSegment.segment.id}`,
        left: 0,
        width: firstSegment.left,
        startTime: 0,
        endTime: firstSegment.segment.start,
      })
    }
    // Gaps between segments
    if (trackLayout.segments.length >= 1) {
      for (let i = 0; i < trackLayout.segments.length - 1; i++) {
        const current = trackLayout.segments[i]
        const next = trackLayout.segments[i + 1]
        if (next.segment.start > current.segment.end) {
          gaps.push({
            id: `${current.segment.id}-${next.segment.id}`,
            left: current.left + current.width,
            width: next.left - (current.left + current.width),
            startTime: current.segment.end,
            endTime: next.segment.start,
          })
        }
      }
    }
    return {
      trackId: trackLayout.track.id,
      gaps,
    }
  })
})

function getGapsForTrack(trackId: string) {
  const renderWindow = { startPx: props.visibleStartPx, endPx: props.visibleEndPx }
  return (trackGaps.value.find(tg => tg.trackId === trackId)?.gaps || [])
    .filter(gap => intersectsTimelineRenderWindow(gap.left, gap.width, renderWindow))
}
</script>

<template>
  <div
    class="ve-timeline__tracks"
    :class="{ 've-timeline__tracks--with-rail': showTrackRail }"
    :style="{ gap: `${trackGap}px`, paddingTop: `${trackGap}px` }"
  >
    <div
      v-for="trackLayout in tracks"
      :key="trackLayout.track.id"
      class="ve-track"
      :class="{
        've-track--main': trackLayout.track.isMain,
        've-track--hidden': trackLayout.track.hidden,
        've-track--muted': trackLayout.track.muted,
        've-track--has-selection': trackLayout.segments.some((layout: SegmentLayout) => layout.isSelected),
        've-track--with-rail': showTrackRail,
      }"
      :style="{ height: `${resolveTrackHeight(trackLayout.trackIndex)}px` }"
    >
      <div v-if="showTrackRail" class="ve-track__rail">
        <slot
          name="track-rail"
          :track="trackLayout.track"
          :index="trackLayout.trackIndex"
          :segments="trackLayout.segments"
          :height="resolveTrackHeight(trackLayout.trackIndex)"
        />
      </div>
      <div class="ve-track__body">
        <div
          v-for="layout in getRenderedSegments(trackLayout)"
          v-show="dragPreview?.segment.id !== layout.segment.id"
          :key="layout.segment.id"
          class="ve-segment"
          :class="{
            've-segment--selected': layout.isSelected,
          }"
          :style="{
            left: `${segmentGeometry(layout).left}px`,
            width: `${segmentGeometry(layout).width}px`,
            backgroundColor: layout.segment.color || trackLayout.track.color || 'var(--ve-primary, #222226)',
          }"
          @mousedown.prevent.stop="handleSegmentMouseDown(layout, $event)"
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
                {{ (layout.segment.start / 1000).toFixed(2) }}s - {{ (layout.segment.end / 1000).toFixed(2) }}s
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
              @mousedown.stop="handleResizeStart(layout, 'start', $event)"
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
              @mousedown.stop="handleResizeStart(layout, 'end', $event)"
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

        <!-- Gaps between segments -->
        <div
          v-for="gap in getGapsForTrack(trackLayout.track.id)"
          :key="gap.id"
          class="ve-track__gap-add"
          :style="{ left: `${gap.left}px`, width: `${gap.width}px` }"
          @click.stop="handleAddAt(trackLayout.track, gap.startTime, gap.endTime, $event)"
        >
          <div class="ve-track__gap-add-icon">
            <span class="ve-track__add-icon i-creatly-add" aria-hidden="true" />
          </div>
        </div>

        <!-- Add button at the end of the main track -->
        <template v-if="trackLayout.track.isMain">
          <div
            class="ve-track__add-button"
            :style="{
              left: trackLayout.segments.length > 0
                ? `${trackLayout.segments[trackLayout.segments.length - 1].left + trackLayout.segments[trackLayout.segments.length - 1].width}px`
                : '0px',
            }"
            @click.stop="handleAddAt(trackLayout.track, trackLayout.segments.length > 0 ? trackLayout.segments[trackLayout.segments.length - 1].segment.end : 0, undefined, $event)"
          >
            <span class="ve-track__add-icon i-creatly-add" aria-hidden="true" />
          </div>
        </template>
      </div><!-- .ve-track__body -->

      <!-- Row-level overlay (track controls), drawn above the track body -->
      <slot
        name="track"
        :track="trackLayout.track"
        :index="trackLayout.trackIndex"
        :segments="trackLayout.segments"
        :height="resolveTrackHeight(trackLayout.trackIndex)"
      />
    </div>
  </div>
</template>

<style scoped>
.ve-timeline__tracks {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.ve-timeline__tracks--with-rail {
  /* The content box already includes the rail, so rows span it exactly. Adding
     the rail width here made every row overhang by 24px. */
  width: 100%;
}

.ve-track {
  position: relative;
  overflow: hidden;
}

.ve-track--with-rail {
  display: flex;
  align-items: stretch;
  overflow: visible;
  gap: 2px;
}

.ve-track__rail {
  position: sticky;
  left: 0;
  z-index: 25;
  display: flex;
  flex: 0 0 var(--ve-track-rail-width, 24px);
  align-items: stretch;
  width: var(--ve-track-rail-width, 24px);
  height: 100%;
  /* The rail is sticky, so it must stay opaque to occlude segments scrolling
     underneath it. It used to `inherit` the row colour from `.ve-track`; now
     that the row colour lives on `.ve-track__body`, the column needs its own
     surface — which is also what the design shows (card surface, with the
     rounded 5% cell drawn inside it). */
  background: var(--ve-track-rail-column-background, #fff);
}

/* Row colour lives on the body, not on `.ve-track` — the track element spans
   the rail column too, and the rail is a separate surface. */
.ve-track__body {
  position: relative;
  /* Fill all space after the sticky rail. An auto basis can preserve the
     body's intrinsic width and leave an unused strip at the row end. */
  flex: 1 1 0%;
  min-width: 0;
  height: 100%;
  background-color: var(--ve-track-background, #f5f5f5);
}

.ve-track--main .ve-track__body {
  background-color: var(--ve-track-main-background, #f1f1f1);
}

/* Declared after `--main` so a selected main track reads as selected. The extra
   class also outranks the base rule on specificity, so no `!important`. */
.ve-track--has-selection .ve-track__body {
  background-color: var(--ve-track-selected-background, rgba(90, 90, 255, 0.04));
  box-shadow:
    inset 0 1px 0 0 var(--ve-track-selected-border, rgba(90, 90, 255, 0.35)),
    inset 0 -1px 0 0 var(--ve-track-selected-border, rgba(90, 90, 255, 0.35));
}

/* A hidden track keeps its layout but reads as inactive */
.ve-track--hidden .ve-track__body {
  opacity: 0.4;
}

/* Muting affects sound, not visibility. Keep the row readable while making
   the state obvious even when the rail controls are not hovered. */
.ve-track--muted .ve-track__body {
  box-shadow: inset 0 0 0 1px var(--ve-track-muted-border, rgba(220, 38, 38, 0.28));
}

.ve-track--muted .ve-segment {
  opacity: 0.5;
  filter: grayscale(0.85);
}

.ve-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  color: var(--ve-content-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  overflow: hidden;
  transition:
    background-color 150ms,
    border-color 150ms,
    box-shadow 150ms;
}

.ve-segment__content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
}

.ve-segment__title {
  font-size: 12px;
  font-weight: bold;
  text-transform: capitalize;
}

.ve-segment__time {
  font-size: 11px;
  color: var(--ve-content-secondary);
  font-family: monospace;
}

.ve-segment__selection {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  top: 0;
  pointer-events: none;
  z-index: 10;
}

.ve-segment__handle {
  position: absolute;
  height: 100%;
  width: 4px;
  background-color: var(--ve-segment-handle-color, #222226);
  cursor: ew-resize;
  pointer-events: auto;
  border: 2px solid var(--ve-segment-handle-color, #222226);
}

.ve-segment__handle--left {
  left: 0;
  top: 0;
  border-radius: 0.25rem 0 0 0.25rem;
}

.ve-segment__handle--right {
  right: 0;
  top: 0;
  border-radius: 0 0.25rem 0.25rem 0;
}

.ve-segment__handle-dots {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
  justify-content: center;
}

.ve-segment__handle-dot {
  border-radius: 9999px;
  background-color: var(--ve-segment-handle-dot-color, #fff);
  width: 1px;
  height: 1px;
}

.ve-track__add-button {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 0.5rem;
  width: var(--ve-add-size, 40px);
  height: var(--ve-add-size, 40px);
  border: none;
  border-radius: var(--ve-add-radius, 8px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ve-track-add-button-color, #222226);
  border: 1px solid var(--ve-track-add-button-border, rgba(34, 34, 38, 0.08));
  background-color: var(--ve-track-add-button-background, #fff);
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.ve-track__add-button:hover {
  color: var(--ve-track-add-button-color, #222226);
  background-color: var(--ve-track-add-button-hover-background, #eee);
}

.ve-track__gap-add {
  position: absolute;
  top: 0;
  bottom: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ve-track__gap-add:hover {
  background-color: var(--ve-track-gap-add-hover-background, transparent);
}

.ve-track__gap-add-icon {
  display: none;
  color: var(--ve-track-gap-add-icon-color, #fff);
  background-color: var(--ve-track-gap-add-icon-background, #222226);
  padding: 4px;
  border-radius: 4px;
}

.ve-track__gap-add:hover .ve-track__gap-add-icon {
  display: block;
}

.ve-track__add-button .ve-track__add-icon,
.ve-track__gap-add .ve-track__add-icon {
  display: block;
  width: var(--ve-btn-icon-size, 16px);
  height: var(--ve-btn-icon-size, 16px);
}
</style>
