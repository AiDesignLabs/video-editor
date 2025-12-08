<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

defineOptions({ name: 'TimelineRoot' })

const props = withDefaults(defineProps<{
  duration: number
  currentTime: number
  zoom?: number
  minZoom?: number
  maxZoom?: number
  fps?: number
}>(), {
  zoom: 1,
  minZoom: 0.25,
  maxZoom: 10,
  fps: 30,
})

const emit = defineEmits<{
  (e: 'update:currentTime', value: number): void
  (e: 'update:zoom', value: number): void
}>()

const viewportRef = ref<HTMLElement | null>(null)
const viewportWidth = ref(0)
let resizeObserver: ResizeObserver | null = null

const innerZoom = ref(clampZoom(props.zoom ?? 1))
watch(() => props.zoom, (value) => {
  if (typeof value === 'number')
    innerZoom.value = clampZoom(value)
})
watch(innerZoom, value => emit('update:zoom', value))

const pixelsPerMs = computed(() => {
  const duration = Math.max(props.duration, 1)
  const width = Math.max(viewportWidth.value, 1)
  return (width * innerZoom.value) / duration
})

const contentWidthPx = computed(() => {
  const derived = props.duration * pixelsPerMs.value
  return Math.max(derived || 0, viewportWidth.value || 0)
})

onMounted(() => {
  if (viewportRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      viewportWidth.value = entry?.contentRect.width || viewportRef.value?.clientWidth || 0
    })
    resizeObserver.observe(viewportRef.value)
    viewportWidth.value = viewportRef.value.clientWidth || 0
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

function clampZoom(value: number) {
  if (!Number.isFinite(value))
    return props.minZoom
  return Math.min(Math.max(value, props.minZoom), props.maxZoom)
}

defineExpose({
  viewportRef,
  pixelsPerMs,
  contentWidthPx,
  innerZoom,
})
</script>

<template>
  <div ref="viewportRef" :style="{ '--ve-fps': String(props.fps || 30) }" class="ve-root">
    <div class="ve-root__content" :style="{ width: `${contentWidthPx}px` }">
      <slot :pixels-per-ms="pixelsPerMs" :content-width="contentWidthPx" :zoom="innerZoom" />
    </div>
  </div>
</template>

<style scoped>
:where(.ve-root) {
  --at-apply: relative overflow-auto w-full bg-gradient-to-b from-white to-[#f9fafb];
  min-height: 100%;
}

:where(.ve-root .ve-root__content) {
  --at-apply: relative min-h-full;
}
</style>
