<script setup lang="ts">
import type { ITextSegment } from '@video-editor/shared'
import { computed } from 'vue'

defineOptions({ name: 'TextSegment' })

const props = defineProps<{
  segment: ITextSegment
}>()

const preview = computed(() => {
  const first = props.segment.texts.find(item => !!item.content)
  return first?.content ?? ''
})

const lineCount = computed(() => props.segment.texts.filter(item => !!item.content).length)
</script>

<template>
  <div class="text-segment">
    <span class="text-segment__pill">text</span>
    <span class="text-segment__preview">{{ preview }}</span>
    <span v-if="lineCount > 1" class="text-segment__lines">×{{ lineCount }}</span>
  </div>
</template>

<style scoped>
:where(.text-segment) {
  --at-apply: relative flex items-center gap-1.5 w-full h-full p-1.5 rounded-4px overflow-hidden;
  background: var(--ve-surface-control-subtle);
  box-shadow: inset 0 0 0 1px var(--ve-border-weak);
}

:where(.text-segment .text-segment__pill) {
  --at-apply: inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap;
  color: var(--ve-segment-accent, #16a34a);
  background: rgba(22, 163, 74, 0.1);
  box-shadow: inset 0 0 0 1px var(--ve-border-weak);
}

:where(.text-segment .text-segment__preview) {
  --at-apply: text-[12px] truncate;
  color: var(--ve-content-primary);
}

:where(.text-segment .text-segment__lines) {
  --at-apply: ml-auto text-[11px] whitespace-nowrap;
  color: var(--ve-content-secondary);
}
</style>
