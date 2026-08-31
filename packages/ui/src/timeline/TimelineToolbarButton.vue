<script setup lang="ts">
import type { ToolbarButtonAction } from './toolbar-actions'

/**
 * The package's own toolbar button. Exported so a host that needs to decorate
 * buttons — a tooltip directive from its component library, an analytics
 * wrapper — can do so through the `toolbar-button` slot without reimplementing
 * the markup and losing the design system:
 *
 * ```vue
 * <template #toolbar-button="{ action }">
 *   <TimelineToolbarButton v-tooltip.top="action.label" :action="action" />
 * </template>
 * ```
 *
 * Single-rooted on purpose: attributes and directives a host puts on the
 * component land on the real `<button>`.
 */
defineOptions({ name: 'TimelineToolbarButton', inheritAttrs: true })

defineProps<{ action: ToolbarButtonAction }>()
</script>

<template>
  <button
    class="ve-btn"
    :class="{ 've-btn--strong': action.strong, 've-btn--active': action.active }"
    type="button"
    :disabled="action.disabled"
    :title="action.title ?? action.label"
    :aria-label="action.label"
    :aria-pressed="action.active === undefined ? undefined : !!action.active"
    @click="action.onSelect($event)"
  >
    <span class="ve-btn__icon" :class="action.icon" aria-hidden="true" />
  </button>
</template>
