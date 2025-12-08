<script setup lang="ts">
import type { SegmentUnion } from '@video-editor/shared'
import { computed } from 'vue'

defineOptions({ name: 'SegmentBase' })

const props = withDefaults(defineProps<{
  segment: SegmentUnion
  trackType: string
  accentColor?: string
}>(), {
  accentColor: '#222226',
})

const label = computed(() => {
  const maybeLabel = (props.segment?.extra as Record<string, unknown> | null | undefined)?.label
  return typeof maybeLabel === 'string' ? maybeLabel : null
})
</script>

<template>
  <div class="segment-base">
    <div class="segment-base__content">
      <span class="segment-base__pill segment-base__pill--primary">
        {{ trackType }}
      </span>
      <span class="segment-base__pill segment-base__pill--muted">
        {{ segment.segmentType }}
      </span>
    </div>

    <!-- Label badge -->
    <span v-if="label" class="segment-base__badge">
      {{ label }}
    </span>
  </div>
</template>

<style scoped>
:where(.segment-base) {
  --at-apply: relative flex items-center w-full h-full p-1.5 rounded-4px;
  background: rgba(255, 255, 255, 0.32);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

:where(.segment-base .segment-base__content) {
  --at-apply: flex items-center justify-start gap-1.5 w-full;
}

:where(.segment-base .segment-base__pill) {
  --at-apply: inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}

:where(.segment-base .segment-base__pill--primary) {
  color: var(--ve-segment-accent, #222226);
  background: rgba(34, 34, 38, 0.08);
}

:where(.segment-base .segment-base__pill--muted) {
  color: rgba(15, 23, 42, 0.7);
  background: rgba(34, 34, 38, 0.05);
}

:where(.segment-base .segment-base__badge) {
  --at-apply: absolute top-1.5 left-2 px-1.5 py-0.5 text-[11px] rounded-4px pointer-events-none;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  transform-origin: left top;
  transform: scale(0.9);
}
</style>
