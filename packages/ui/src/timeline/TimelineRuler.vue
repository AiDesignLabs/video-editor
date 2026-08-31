<script setup lang="ts">
import type { TimelineTick } from '../VideoTimeline/types'

defineOptions({ name: 'TimelineRuler' })

defineProps<{
  ticks: TimelineTick[]
}>()
</script>

<template>
  <div class="ve-ruler">
    <div class="ve-ruler__ticks">
      <div
        v-for="tick in ticks"
        :key="tick.timeMs"
        class="ve-ruler__tick"
        :class="{ 've-ruler__tick--major': tick.isMajor }"
        :style="{
          left: `${tick.position}px`,
        }"
      >
        <div class="ve-ruler__line" />
        <div v-if="tick.isMajor && tick.label" class="ve-ruler__label">
          {{ tick.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ve-ruler {
  --at-apply: sticky top-0 left-0 right-0 z-3 overflow-hidden;
  color: var(--ve-content-ruler, rgba(0, 0, 0, 0.55));
  background: var(--ve-ruler-background, #fff);
}

.ve-ruler .ve-ruler__ticks {
  --at-apply: relative h-full w-full box-border;
}

.ve-ruler .ve-ruler__tick {
  --at-apply: absolute top-0 h-full;
}

.ve-ruler .ve-ruler__line {
  --at-apply: w-px;
  height: var(--ve-ruler-minor, 4px);
  background: var(--ve-ruler-tick-color, #e4e4e4);
}

.ve-ruler .ve-ruler__tick--major .ve-ruler__line {
  --at-apply: relative;
  height: var(--ve-ruler-major, 8px);
  background: var(--ve-ruler-tick-major-color, rgba(0, 0, 0, 0.35));
}

/* The label hangs to the right of its tick, aligned to the bottom of the
   ruler band - matching the Figma spec. */
.ve-ruler .ve-ruler__label {
  --at-apply: absolute bottom-0 left-1 whitespace-nowrap;
  font-size: var(--ve-ruler-font-size, 10px);
  font-weight: 400;
  line-height: 1;
  color: var(--ve-content-ruler, rgba(0, 0, 0, 0.55));
  font-family: var(--ve-font-numeric, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
</style>
