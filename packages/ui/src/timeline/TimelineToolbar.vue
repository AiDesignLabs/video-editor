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
        <button class="ve-btn" type="button" :disabled="zoom <= minZoom" @click="emit('zoomOut')">
          -
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
        <button class="ve-btn" type="button" :disabled="zoom >= maxZoom" @click="emit('zoomIn')">
          +
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
  --at-apply: flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#eceff3];
}

:where(.ve-toolbar .ve-toolbar__group) {
  --at-apply: inline-flex items-center gap-2;
}

:where(.ve-toolbar .ve-zoom) {
  --at-apply: min-w-14 text-center text-xs text-[#222226] px-2 py-1 border border-[#e5e7eb] rounded-lg bg-white;
}

:where(.ve-toolbar .ve-btn) {
  --at-apply: border border-[#d1d5db] bg-white text-[#222226] rounded-lg h-7 w-7 cursor-pointer transition-all duration-150;
}

:where(.ve-toolbar .ve-btn:disabled) {
  --at-apply: cursor-not-allowed opacity-45;
}

:where(.ve-toolbar .ve-btn:not(:disabled):hover) {
  --at-apply: border-[#222226] text-[#222226];
}

:where(.ve-toolbar .ve-toolbar__time) {
  --at-apply: inline-flex items-center gap-1.5 text-xs font-mono text-[#222226] ml-auto;
}

:where(.ve-toolbar .ve-toolbar__time-divider) {
  --at-apply: text-[#9ca3af];
}
</style>
