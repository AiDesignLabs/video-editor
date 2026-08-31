<script setup lang="ts">
import type { SegmentUnion } from '@video-editor/shared'
import { computed } from 'vue'

defineOptions({ name: 'SegmentBase' })

const props = withDefaults(defineProps<{
  segment: SegmentUnion
  trackType: string
  accentColor?: string
}>(), {
  accentColor: '',
})

/**
 * No design exists yet for sticker / effect / filter segments, so they follow
 * the conventions the rest of the timeline already uses:
 *
 * - a neutral overlay surface (same family as the audio segment), never a
 *   saturated fill — in the shipped design colour comes from media, not chrome;
 * - track identity carried by a thin accent bar plus the icon, so the type is
 *   readable at a glance without flooding the row;
 * - 11px secondary label, 12px icon, 4px radius, 0.5px inset border.
 *
 * Everything is token-driven, so both themes work and a consumer can retune
 * without touching markup.
 */
const ICON_BY_TRACK_TYPE: Record<string, string> = {
  sticker: 'i-creatly-element',
  effect: 'i-creatly-star',
  filter: 'i-creatly-brush',
  text: 'i-creatly-text',
}

const icon = computed(() => ICON_BY_TRACK_TYPE[props.trackType] ?? 'i-creatly-element')

/** A host-supplied name wins over the raw segment type. */
const label = computed(() => {
  const maybeLabel = (props.segment?.extra as Record<string, unknown> | null | undefined)?.label
  if (typeof maybeLabel === 'string' && maybeLabel)
    return maybeLabel

  const named = (props.segment as { name?: unknown } | null)?.name
  if (typeof named === 'string' && named)
    return named

  return props.segment.segmentType
})
</script>

<template>
  <div class="segment-base" :style="accentColor ? { '--ve-segment-accent': accentColor } : undefined">
    <span class="segment-base__accent" aria-hidden="true" />
    <span class="segment-base__icon" :class="icon" aria-hidden="true" />
    <span class="segment-base__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.segment-base {
  --at-apply: relative flex items-center w-full h-full overflow-hidden;
  gap: var(--ve-segment-meta-gap, 6px);
  padding-inline: var(--ve-segment-meta-padding-x, 8px);
  padding-left: calc(var(--ve-segment-accent-bar-width, 3px) + var(--ve-segment-meta-padding-x, 8px));
  border-radius: var(--ve-segment-radius, 4px);
  background: var(--ve-segment-meta-background, rgba(0, 0, 0, 0.05));
  box-shadow: inset 0 0 0 var(--ve-stroke-width, 0.5px) var(--ve-segment-meta-border, rgba(34, 34, 38, 0.08));
}

/* Track identity, without tinting the whole segment. */
.segment-base .segment-base__accent {
  --at-apply: absolute left-0 top-0 bottom-0 pointer-events-none;
  width: var(--ve-segment-accent-bar-width, 3px);
  background: var(--ve-segment-accent, currentcolor);
}

.segment-base .segment-base__icon {
  --at-apply: block flex-shrink-0;
  width: var(--ve-segment-meta-icon-size, 12px);
  height: var(--ve-segment-meta-icon-size, 12px);
  color: var(--ve-segment-accent, currentcolor);
}

.segment-base .segment-base__label {
  --at-apply: truncate text-[11px] capitalize;
  line-height: 16px;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}
</style>
