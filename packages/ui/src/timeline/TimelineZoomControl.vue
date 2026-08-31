<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'TimelineZoomControl' })

const props = withDefaults(defineProps<{
  zoom: number
  minZoom?: number
  maxZoom?: number
  /** Hide the slider and keep only the two buttons. */
  showSlider?: boolean
}>(), {
  minZoom: 0.25,
  maxZoom: 10,
  showSlider: true,
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

  <label v-if="showSlider" class="ve-slider" :style="{ '--ve-slider-fill': fillPercent }">
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
</template>

<style scoped>
.ve-slider {
  --at-apply: relative inline-flex items-center shrink-0;
  width: var(--ve-slider-width, 160px);
  height: var(--ve-slider-knob-size, 16px);
}

.ve-slider__track,
.ve-slider__fill {
  --at-apply: absolute left-0 pointer-events-none;
  height: var(--ve-slider-track-height, 4px);
  border-radius: calc(var(--ve-slider-track-height, 4px) / 2);
}

.ve-slider__track {
  --at-apply: w-full;
  background: var(--ve-slider-track-color, rgba(34, 34, 38, 0.12));
}

.ve-slider__fill {
  width: var(--ve-slider-fill, 0%);
  background: var(--ve-slider-fill-color, #222226);
}

/* The native input stays on top so it keeps keyboard and pointer behaviour;
   only its thumb is painted. */
.ve-slider__input {
  --at-apply: relative w-full m-0 bg-transparent cursor-pointer;
  appearance: none;
  height: var(--ve-slider-knob-size, 16px);
}

.ve-slider__input::-webkit-slider-thumb {
  appearance: none;
  width: var(--ve-slider-knob-size, 16px);
  height: var(--ve-slider-knob-size, 16px);
  border: var(--ve-slider-knob-border, 3px) solid var(--ve-slider-fill-color, #222226);
  border-radius: 50%;
  background: var(--ve-surface-elevated, #fff);
  cursor: pointer;
}

.ve-slider__input::-moz-range-thumb {
  width: var(--ve-slider-knob-size, 16px);
  height: var(--ve-slider-knob-size, 16px);
  border: var(--ve-slider-knob-border, 3px) solid var(--ve-slider-fill-color, #222226);
  border-radius: 50%;
  background: var(--ve-surface-elevated, #fff);
  cursor: pointer;
}

.ve-slider__input::-moz-range-track {
  background: transparent;
}
</style>
