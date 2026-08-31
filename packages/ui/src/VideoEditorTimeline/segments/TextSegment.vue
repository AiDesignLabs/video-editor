<script setup lang="ts">
import type { ITextSegment } from '@video-editor/shared'
import { computed } from 'vue'

defineOptions({ name: 'TextSegment' })

const props = defineProps<{
  segment: ITextSegment
}>()

/**
 * Shares the "no media to show" language defined in SegmentBase — neutral
 * surface, accent bar, 12px icon — but keeps the caption preview, which is the
 * one thing that makes a text segment identifiable on the timeline.
 */
const preview = computed(() => {
  const first = props.segment.texts.find(item => !!item.content)
  return first?.content ?? ''
})

const lineCount = computed(() => props.segment.texts.filter(item => !!item.content).length)
</script>

<template>
  <div class="text-segment">
    <span class="text-segment__accent" aria-hidden="true" />
    <span class="text-segment__icon i-creatly-text" aria-hidden="true" />
    <span v-if="preview" class="text-segment__preview">{{ preview }}</span>
    <span v-else class="text-segment__placeholder">text</span>
    <span v-if="lineCount > 1" class="text-segment__lines">×{{ lineCount }}</span>
  </div>
</template>

<style scoped>
.text-segment {
  --at-apply: relative flex items-center w-full h-full overflow-hidden;
  gap: var(--ve-segment-meta-gap, 6px);
  padding-inline: var(--ve-segment-meta-padding-x, 8px);
  padding-left: calc(var(--ve-segment-accent-bar-width, 3px) + var(--ve-segment-meta-padding-x, 8px));
  border-radius: var(--ve-segment-radius, 4px);
  background: var(--ve-segment-meta-background, rgba(0, 0, 0, 0.05));
  box-shadow: inset 0 0 0 var(--ve-stroke-width, 0.5px) var(--ve-segment-meta-border, rgba(34, 34, 38, 0.08));
}

.text-segment .text-segment__accent {
  --at-apply: absolute left-0 top-0 bottom-0 pointer-events-none;
  width: var(--ve-segment-accent-bar-width, 3px);
  background: var(--ve-segment-accent, currentcolor);
}

.text-segment .text-segment__icon {
  --at-apply: block flex-shrink-0;
  width: var(--ve-segment-meta-icon-size, 12px);
  height: var(--ve-segment-meta-icon-size, 12px);
  color: var(--ve-segment-accent, currentcolor);
}

.text-segment .text-segment__preview {
  --at-apply: truncate text-[12px];
  line-height: 20px;
  color: var(--ve-content-primary, rgba(0, 0, 0, 0.9));
}

.text-segment .text-segment__placeholder {
  --at-apply: truncate text-[11px] capitalize;
  line-height: 16px;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}

/* Line count sits at the far edge so it stays visible as the segment narrows. */
.text-segment .text-segment__lines {
  --at-apply: ml-auto flex-shrink-0 text-[11px] whitespace-nowrap;
  line-height: 16px;
  color: var(--ve-content-tertiary, rgba(0, 0, 0, 0.35));
}
</style>
