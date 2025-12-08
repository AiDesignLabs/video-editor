<script setup lang="ts">
import type { SegmentLayout, TimelineTrack } from '../VideoTimeline/types'

defineOptions({ name: 'TimelineTracks' })

defineProps<{
  tracks: Array<{
    track: TimelineTrack
    trackIndex: number
    segments: SegmentLayout[]
  }>
  trackHeight: number
  trackGap: number
  pixelsPerMs: number
}>()
</script>

<template>
  <div class="ve-tracks" :style="{ gap: `${trackGap}px`, paddingTop: `${trackGap}px` }">
    <div
      v-for="trackLayout in tracks"
      :key="trackLayout.track.id"
      class="ve-track"
      :style="{ height: `${trackHeight}px` }"
    >
      <slot
        name="track"
        :track="trackLayout.track"
        :index="trackLayout.trackIndex"
        :segments="trackLayout.segments"
        :pixels-per-ms="pixelsPerMs"
        :height="trackHeight"
      >
        <div class="ve-track__body">
          <div
            v-for="layout in trackLayout.segments"
            :key="layout.segment.id"
            class="ve-segment"
            :class="{
              've-segment--selected': layout.isSelected,
              've-segment--dragging': false,
            }"
            :style="{
              left: `${layout.left}px`,
              width: `${layout.width}px`,
              backgroundColor: layout.segment.color || trackLayout.track.color || 'var(--ve-primary)',
            }"
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
          </div>
        </div>
      </slot>
    </div>
  </div>
</template>

<style scoped>
:where(.ve-tracks) {
  --at-apply: relative z-1 pb-3;
}

:where(.ve-track) {
  --at-apply: relative flex bg-[#f8fafc] border border-[#e5e7eb] rounded-[10px] overflow-hidden;
}

:where(.ve-track__body) {
  --at-apply: relative h-full;
}

:where(.ve-segment) {
  --at-apply: absolute top-1.5 bottom-1.5 rounded-[10px] text-[#0f172a] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] cursor-pointer flex items-center px-2.5 py-1.5 overflow-hidden transition-[box-shadow,transform] duration-150;
}

:where(.ve-segment--selected) {
  --at-apply: shadow-[0_0_0_2px_var(--ve-primary),inset_0_0_0_1px_rgba(255,255,255,0.45)];
}

:where(.ve-segment--dragging) {
  --at-apply: opacity-50;
}

:where(.ve-segment__content) {
  --at-apply: flex flex-col gap-1;
}

:where(.ve-segment__title) {
  --at-apply: text-[12px] font-bold capitalize;
}

:where(.ve-segment__time) {
  --at-apply: text-[11px] text-[rgba(15,23,42,0.8)] font-mono;
}
</style>
