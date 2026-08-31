<script setup lang="ts">
import type { ToolbarAction, ToolbarButtonAction, ToolbarStatusAction, ToolbarZoomAction } from './toolbar-actions'
import TimelineToolbarButton from './TimelineToolbarButton.vue'
import TimelineZoomControl from './TimelineZoomControl.vue'

defineOptions({ name: 'TimelineToolbarAction' })

const props = withDefaults(defineProps<{
  action: ToolbarAction
  zoom?: number
  minZoom?: number
  maxZoom?: number
  showZoomSlider?: boolean
}>(), {
  zoom: 1,
  minZoom: 0.25,
  maxZoom: 10,
  showZoomSlider: true,
})

const emit = defineEmits<{
  (e: 'zoomIn'): void
  (e: 'zoomOut'): void
  (e: 'update:zoom', zoom: number): void
}>()

/**
 * The template cannot discriminate the action union on `kind`, because the
 * button variant leaves `kind` optional. Cast per branch instead.
 */
const asButton = () => props.action as ToolbarButtonAction
const asStatus = () => props.action as ToolbarStatusAction
const asZoom = () => props.action as ToolbarZoomAction
</script>

<template>
  <span v-if="action.kind === 'divider'" class="ve-toolbar-divider" />

  <span v-else-if="action.kind === 'status'" class="ve-toolbar-status">
    <span v-if="asStatus().icon" class="ve-btn__icon" :class="asStatus().icon" aria-hidden="true" />
    {{ asStatus().text }}
  </span>

  <TimelineZoomControl
    v-else-if="action.kind === 'zoom'"
    :zoom="zoom"
    :min-zoom="minZoom"
    :max-zoom="maxZoom"
    :show-slider="asZoom().slider !== false && showZoomSlider"
    @zoom-in="emit('zoomIn')"
    @zoom-out="emit('zoomOut')"
    @update:zoom="emit('update:zoom', $event)"
  />

  <!-- `slot` actions render nothing here: the parent's `action-<id>` slot owns
       them, and reaching this branch means the consumer left it unfilled. -->
  <template v-else-if="action.kind !== 'slot'">
    <!-- One override for every button, so a host with its own button component
         (and its own tooltip) keeps the shared action list instead of
         reimplementing the toolbar. -->
    <slot name="button" :action="asButton()">
      <TimelineToolbarButton :action="asButton()" />
    </slot>
  </template>
</template>
