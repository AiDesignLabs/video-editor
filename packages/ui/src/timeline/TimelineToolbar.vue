<script setup lang="ts">
defineOptions({ name: 'TimelineToolbar' })

withDefaults(defineProps<{
  zoom: number
  minZoom?: number
  maxZoom?: number
  currentTime?: number
  duration?: number
  formatTime?: (ms: number) => string
}>(), {
  minZoom: 0.25,
  maxZoom: 10,
  currentTime: 0,
  duration: 0,
  formatTime: (ms: number) => `${(ms / 1000).toFixed(2)}s`,
})

const emit = defineEmits<{
  (e: 'zoomIn'): void
  (e: 'zoomOut'): void
}>()
</script>

<template>
  <div class="ve-toolbar">
    <div class="ve-toolbar__group">
      <slot name="left-actions">
        <button class="ve-btn" type="button" :disabled="zoom <= minZoom" title="Zoom out" aria-label="Zoom out" @click="emit('zoomOut')">
          <span class="ve-btn__icon i-creatly-zoom-out" aria-hidden="true" />
        </button>
      </slot>
    </div>

    <div class="ve-toolbar__group">
      <slot name="center">
        <div class="ve-zoom">
          {{ (zoom * 100).toFixed(0) }}%
        </div>
      </slot>
    </div>

    <div class="ve-toolbar__group">
      <slot name="right-actions">
        <button class="ve-btn" type="button" :disabled="zoom >= maxZoom" title="Zoom in" aria-label="Zoom in" @click="emit('zoomIn')">
          <span class="ve-btn__icon i-creatly-zoom-in" aria-hidden="true" />
        </button>
      </slot>
    </div>

    <div class="ve-toolbar__time">
      <slot name="time" :current-time="currentTime" :duration="duration">
        <span>{{ formatTime?.(currentTime || 0) }}</span>
        <span class="ve-toolbar__time-divider">/</span>
        <span>{{ formatTime?.(duration || 0) }}</span>
      </slot>
    </div>
  </div>
</template>

<style scoped>
:where(.ve-toolbar) {
  --at-apply: flex items-center justify-between gap-2 px-3 py-2.5 border-b;
  border-color: var(--ve-border-weak);
}

:where(.ve-toolbar .ve-toolbar__group) {
  --at-apply: inline-flex items-center gap-2;
}

:where(.ve-toolbar .ve-zoom) {
  --at-apply: min-w-14 text-center text-xs px-2 py-1 border rounded-lg;
  color: var(--ve-content-primary);
  border-color: var(--ve-border-weak);
  background: var(--ve-surface-elevated);
}

:where(.ve-toolbar .ve-btn) {
  --at-apply: border rounded-lg h-7 w-7 cursor-pointer transition-all duration-150 flex items-center justify-center;
  color: var(--ve-content-primary);
  border-color: var(--ve-border-subtle);
  background: var(--ve-surface-elevated);
}

:where(.ve-toolbar .ve-btn__icon) {
  --at-apply: block h-4 w-4;
}

:where(.ve-toolbar .ve-btn:disabled) {
  --at-apply: cursor-not-allowed opacity-45;
}

:where(.ve-toolbar .ve-btn:not(:disabled):hover) {
  color: var(--ve-content-primary);
  border-color: var(--ve-content-primary);
}

:where(.ve-toolbar .ve-toolbar__time) {
  --at-apply: inline-flex items-center gap-1.5 text-xs font-mono ml-auto;
  color: var(--ve-content-primary);
}

:where(.ve-toolbar .ve-toolbar__time-divider) {
  color: var(--ve-content-tertiary);
}
</style>
