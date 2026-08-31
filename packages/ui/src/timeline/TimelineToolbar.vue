<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'TimelineToolbar' })

const props = withDefaults(defineProps<{
  zoom: number
  minZoom?: number
  maxZoom?: number
  currentTime?: number
  duration?: number
  formatTime?: (ms: number) => string
  /** Hide the built-in zoom slider when the host supplies its own. */
  showZoomSlider?: boolean
}>(), {
  minZoom: 0.25,
  maxZoom: 10,
  currentTime: 0,
  duration: 0,
  formatTime: (ms: number) => `${(ms / 1000).toFixed(2)}s`,
  showZoomSlider: true,
})

const emit = defineEmits<{
  (e: 'zoomIn'): void
  (e: 'zoomOut'): void
  (e: 'update:zoom', zoom: number): void
}>()

/**
 * Zoom is geometric, so a linear slider would spend most of its travel in the
 * high end. Map the handle position through log space to keep it even.
 */
const sliderValue = computed({
  get() {
    const { zoom, minZoom, maxZoom } = props
    if (maxZoom <= minZoom)
      return 0
    const ratio = Math.log(zoom / minZoom) / Math.log(maxZoom / minZoom)
    return Math.round(Math.min(Math.max(ratio, 0), 1) * 100)
  },
  set(value: number) {
    const { minZoom, maxZoom } = props
    const ratio = Math.min(Math.max(value, 0), 100) / 100
    emit('update:zoom', minZoom * (maxZoom / minZoom) ** ratio)
  },
})

const fillPercent = computed(() => `${sliderValue.value}%`)
</script>

<template>
  <div class="ve-toolbar">
    <div class="ve-toolbar__group ve-toolbar__group--left">
      <slot name="left-actions" />
    </div>

    <div class="ve-toolbar__group ve-toolbar__group--center">
      <slot name="center">
        <div class="ve-toolbar__time">
          <slot name="time" :current-time="currentTime" :duration="duration">
            <span>{{ formatTime?.(currentTime || 0) }}</span>
            <span class="ve-toolbar__time-divider">/</span>
            <span>{{ formatTime?.(duration || 0) }}</span>
          </slot>
        </div>
      </slot>
    </div>

    <div class="ve-toolbar__group ve-toolbar__group--right">
      <!-- Prepend point: lets a consumer add controls ahead of the zoom cluster
           without having to override `right-actions` and reimplement zoom. -->
      <slot name="right-actions-leading" />

      <slot name="right-actions">
        <button
          class="ve-btn ve-btn--strong"
          type="button"
          :disabled="zoom <= minZoom"
          title="Zoom out"
          aria-label="Zoom out"
          @click="emit('zoomOut')"
        >
          <span class="ve-btn__icon i-creatly-zoom-out" aria-hidden="true" />
        </button>

        <label v-if="showZoomSlider" class="ve-slider" :style="{ '--ve-slider-fill': fillPercent }">
          <span class="ve-slider__track" aria-hidden="true" />
          <span class="ve-slider__fill" aria-hidden="true" />
          <input
            v-model.number="sliderValue"
            class="ve-slider__input"
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="Zoom"
          >
        </label>

        <button
          class="ve-btn ve-btn--strong"
          type="button"
          :disabled="zoom >= maxZoom"
          title="Zoom in"
          aria-label="Zoom in"
          @click="emit('zoomIn')"
        >
          <span class="ve-btn__icon i-creatly-zoom-in" aria-hidden="true" />
        </button>
      </slot>

      <slot name="right-actions-trailing" />
    </div>
  </div>
</template>

<style scoped>
.ve-toolbar {
  --at-apply: flex items-center;
  gap: var(--ve-toolbar-gap, 8px);
  height: var(--ve-toolbar-height, 46px);
  padding: 0 var(--ve-timeline-padding, 8px);
}

.ve-toolbar .ve-toolbar__group {
  --at-apply: inline-flex items-center;
  gap: var(--ve-toolbar-gap, 8px);
  height: var(--ve-btn-size, 24px);
}

.ve-toolbar .ve-toolbar__group--left {
  --at-apply: flex-1 justify-start min-w-0;
}

.ve-toolbar .ve-toolbar__group--center {
  --at-apply: justify-center shrink-0;
}

.ve-toolbar .ve-toolbar__group--right {
  --at-apply: flex-1 justify-end min-w-0;
}

/* `.ve-btn` / `.ve-toolbar-divider` live in theme.css so slotted content can
   use them too — see the comment there. */

/* Time readout ----------------------------------------------------------- */

.ve-toolbar .ve-toolbar__time {
  --at-apply: inline-flex items-center gap-1 whitespace-nowrap;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--ve-content-primary, #222226);
  font-variant-numeric: tabular-nums;
}

.ve-toolbar .ve-toolbar__time-divider {
  color: var(--ve-content-tertiary, rgba(0, 0, 0, 0.35));
}

/* Zoom slider ------------------------------------------------------------ */

.ve-toolbar .ve-slider {
  --at-apply: relative inline-flex items-center shrink-0;
  width: var(--ve-slider-width, 160px);
  height: var(--ve-slider-knob-size, 16px);
}

.ve-toolbar .ve-slider__track,
.ve-toolbar .ve-slider__fill {
  --at-apply: absolute left-0 pointer-events-none;
  height: var(--ve-slider-track-height, 4px);
  border-radius: calc(var(--ve-slider-track-height, 4px) / 2);
}

.ve-toolbar .ve-slider__track {
  --at-apply: w-full;
  background: var(--ve-slider-track-color, rgba(34, 34, 38, 0.12));
}

.ve-toolbar .ve-slider__fill {
  width: var(--ve-slider-fill, 0%);
  background: var(--ve-slider-fill-color, #222226);
}

/* The native input stays on top so it keeps keyboard and pointer behaviour;
   only its thumb is painted. */
.ve-toolbar .ve-slider__input {
  --at-apply: relative w-full m-0 bg-transparent cursor-pointer;
  appearance: none;
  height: var(--ve-slider-knob-size, 16px);
}

.ve-toolbar .ve-slider__input::-webkit-slider-thumb {
  appearance: none;
  width: var(--ve-slider-knob-size, 16px);
  height: var(--ve-slider-knob-size, 16px);
  border: var(--ve-slider-knob-border, 3px) solid var(--ve-slider-fill-color, #222226);
  border-radius: 50%;
  background: var(--ve-surface-elevated, #fff);
  cursor: pointer;
}

.ve-toolbar .ve-slider__input::-moz-range-thumb {
  width: var(--ve-slider-knob-size, 16px);
  height: var(--ve-slider-knob-size, 16px);
  border: var(--ve-slider-knob-border, 3px) solid var(--ve-slider-fill-color, #222226);
  border-radius: 50%;
  background: var(--ve-surface-elevated, #fff);
  cursor: pointer;
}

.ve-toolbar .ve-slider__input::-moz-range-track {
  background: transparent;
}
</style>
