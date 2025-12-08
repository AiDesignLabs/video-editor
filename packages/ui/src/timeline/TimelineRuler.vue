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
          transform: 'translateX(-50%)',
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
:where(.ve-ruler) {
  --ve-ruler-major: 8px;
  --ve-ruler-minor: 4px;
  --at-apply: sticky top-0 left-0 right-0 bg-white z-3 border-b border-[#e5e7eb] overflow-hidden;
}

:where(.ve-ruler .ve-ruler__ticks) {
  --at-apply: relative h-full w-full box-border;
}

:where(.ve-ruler .ve-ruler__tick) {
  --at-apply: absolute top-0 h-full text-center text-[#6b7280] text-[11px];
}

:where(.ve-ruler .ve-ruler__line) {
  --at-apply: h-[var(--ve-ruler-minor)] w-px mx-auto bg-[#cbd5e1];
}

:where(.ve-ruler .ve-ruler__tick--major .ve-ruler__line) {
  --at-apply: relative h-[var(--ve-ruler-major)] bg-[#94a3b8];
}

:where(.ve-ruler .ve-ruler__label ) {
  --at-apply: absolute font-mono text-right whitespace-nowrap left-4px bottom-0;
  transform: translateY(-50%);
}
</style>
