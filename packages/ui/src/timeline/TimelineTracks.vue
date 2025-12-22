<script setup lang="ts">
import type { SegmentLayout } from '../VideoTimeline/types'

defineOptions({ name: 'TimelineTracks' })

interface TrackLayout {
  track: {
    id: string
    label?: string
    type?: string
    color?: string
    isMain?: boolean
    payload?: unknown
  }
  trackIndex: number
  segments: SegmentLayout[]
}

defineProps<{
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
</style>
