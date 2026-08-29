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
  --at-apply: sticky top-0 left-0 right-0 z-3 border-b overflow-hidden;
  color: var(--ve-content-secondary);
  border-color: var(--ve-border-weak);
  background: var(--ve-surface-elevated);
}

:where(.ve-ruler .ve-ruler__ticks) {
  --at-apply: relative h-full w-full box-border;
}

:where(.ve-ruler .ve-ruler__tick) {
  --at-apply: absolute top-0 h-full text-center text-[11px];
  color: var(--ve-content-secondary);
}

:where(.ve-ruler .ve-ruler__line) {
  --at-apply: h-[var(--ve-ruler-minor)] w-px mx-auto;
  background: var(--ve-border-subtle);
}

:where(.ve-ruler .ve-ruler__tick--major .ve-ruler__line) {
  --at-apply: relative h-[var(--ve-ruler-major)];
  background: var(--ve-content-tertiary);
}

:where(.ve-ruler .ve-ruler__label ) {
  --at-apply: absolute font-mono text-right whitespace-nowrap left-4px bottom-0;
  transform: translateY(-50%);
}
</style>
