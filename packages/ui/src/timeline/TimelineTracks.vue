<script setup lang="ts">
import type { SegmentLayout, TimelineTrack } from '../VideoTimeline/types'
import { computed } from 'vue'

defineOptions({ name: 'TimelineTracks' })

interface TrackLayout {
  track: TimelineTrack
  trackIndex: number
  segments: SegmentLayout[]
}

const props = defineProps<{
  tracks: TrackLayout[]
  trackHeight: number
  trackGap: number
  selectedSegmentId?: string | null
  dragPreview?: {
    segment: { id: string }
  } | null
  resizePreview?: {
    segment: { id: string }
  } | null
}>()

const emit = defineEmits<{
  'segment-click': [layout: SegmentLayout, event: MouseEvent]
  'segment-mousedown': [layout: SegmentLayout, event: MouseEvent]
  'resize-start': [layout: SegmentLayout, edge: 'start' | 'end', event: MouseEvent]
  'add-segment': [{ track: TrackLayout['track'], startTime: number, endTime?: number, event?: MouseEvent }]
}>()

function handleSegmentClick(layout: SegmentLayout, event: MouseEvent) {
  emit('segment-click', layout, event)
}

function handleSegmentMouseDown(layout: SegmentLayout, event: MouseEvent) {
  emit('segment-mousedown', layout, event)
}

function handleResizeStart(layout: SegmentLayout, edge: 'start' | 'end', event: MouseEvent) {
  emit('resize-start', layout, edge, event)
}

function handleAddAt(track: TrackLayout['track'], startTime: number, endTime?: number, event?: MouseEvent) {
  emit('add-segment', { track, startTime, endTime, event })
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
  return trackGaps.value.find(tg => tg.trackId === trackId)?.gaps || []
}
</script>

<template>
  <div class="ve-timeline__tracks" :style="{ gap: `${trackGap}px`, paddingTop: `${trackGap}px` }">
    <div
      v-for="trackLayout in tracks"
      :key="trackLayout.track.id"
      class="ve-track"
      :class="{
        've-track--main': trackLayout.track.isMain,
        've-track--has-selection': trackLayout.segments.some((layout: SegmentLayout) => layout.isSelected)
      }"
      :style="{ height: `${trackHeight}px` }"
    >
      <slot
        name="track"
        :track="trackLayout.track"
        :index="trackLayout.trackIndex"
        :segments="trackLayout.segments"
        :height="trackHeight"
      >
        <div class="ve-track__body">
          <div
            v-for="layout in trackLayout.segments"
            v-show="dragPreview?.segment.id !== layout.segment.id && resizePreview?.segment.id !== layout.segment.id"
            :key="layout.segment.id"
            class="ve-segment"
            :class="{
              've-segment--selected': layout.isSelected,
            }"
            :style="{
              left: `${layout.left}px`,
              width: `${layout.width}px`,
              backgroundColor: layout.segment.color || trackLayout.track.color || '#222226',
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M5 12H19" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </div>

          <!-- Add button at the end of the main track -->
          <template v-if="trackLayout.track.isMain">
            <div
              class="ve-track__add-button"
              :style="{
                left: trackLayout.segments.length > 0
                  ? `${trackLayout.segments[trackLayout.segments.length - 1].left + trackLayout.segments[trackLayout.segments.length - 1].width}px`
                  : '0px'
              }"
              @click.stop="handleAddAt(trackLayout.track, trackLayout.segments.length > 0 ? trackLayout.segments[trackLayout.segments.length - 1].segment.end : 0, undefined, $event)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M5 12H19" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </template>
        </div>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.ve-timeline__tracks {
  position: relative;
  z-index: 1;
  padding-bottom: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.ve-track {
  position: relative;
  background-color: #f8fafc;
  overflow: hidden;
}

.ve-track--main {
  background-color: #F4F4F6;
}

.ve-track--has-selection {
  background-color: #F2F2FA !important;
  box-shadow: inset 0 1px 0 0 #E4E4FC, inset 0 -1px 0 0 #E4E4FC;
}

.ve-track__body {
  position: relative;
  height: 100%;
}

.ve-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  color: #0f172a;
  cursor: pointer;
  display: flex;
  align-items: center;
  overflow: hidden;
  transition-duration: 150ms;
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
  color: rgba(15, 23, 42, 0.8);
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
  background-color: #222226;
  cursor: ew-resize;
  pointer-events: auto;
  border: 2px solid #222226;
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
  background-color: white;
  width: 1px;
  height: 1px;
}

.ve-track__add-button {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 0.5rem;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #222226;
  background-color: #F2F2FA;
  cursor: pointer;
  transition: background-color 0.2s;
  border: 1px solid #222226;
}

.ve-track__add-button:hover {
  background-color: #E5E5E5;
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
  background-color: #EFEFEF;
}

.ve-track__gap-add-icon {
  display: none;
  color: white;
  background-color: #222226;
  padding: 4px;
  border-radius: 4px;
}

.ve-track__gap-add:hover .ve-track__gap-add-icon {
  display: block;
}
</style>
