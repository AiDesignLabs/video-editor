<script setup lang="ts">
import type { SegmentUnion } from '@video-editor/shared'
import { computed } from 'vue'

defineOptions({ name: 'KeyframeMarkers' })

const props = defineProps<{
  segment: SegmentUnion
}>()

const markers = computed(() => {
  const keyframes = props.segment.keyframes
  if (!keyframes?.length)
    return []
  const durationMs = Math.max(1, props.segment.endTime - props.segment.startTime)
  const times = new Set<number>()
  for (const track of keyframes) {
    for (const frame of track.frames)
      times.add(frame.timeMs)
  }
  return [...times]
    .filter(timeMs => timeMs >= 0 && timeMs <= durationMs)
    .sort((a, b) => a - b)
    .map(timeMs => ({ timeMs, leftPercent: (timeMs / durationMs) * 100 }))
})
</script>

<template>
  <div v-if="markers.length" class="keyframe-markers">
    <span
      v-for="marker in markers"
      :key="marker.timeMs"
      class="keyframe-markers__diamond"
      :style="{ left: `${marker.leftPercent}%` }"
    />
  </div>
</template>

<style scoped>
:where(.keyframe-markers) {
  --at-apply: absolute inset-x-0 top-0.5 h-2 pointer-events-none z-2;
}

:where(.keyframe-markers .keyframe-markers__diamond) {
  --at-apply: absolute w-1.5 h-1.5;
  background: var(--ve-segment-accent, #222226);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
  transform: translateX(-50%) rotate(45deg);
}
</style>
