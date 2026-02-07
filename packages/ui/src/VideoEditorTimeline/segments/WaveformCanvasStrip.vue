<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

defineOptions({ name: 'WaveformCanvasStrip' })

const props = withDefaults(defineProps<{
  peaks: number[]
  barColor?: string
  minBarHeight?: number
  maxBarWidth?: number
  barGap?: number
  maxBufferWidth?: number
  maxBufferHeight?: number
}>(), {
  barColor: '#2B2B2B',
  minBarHeight: 3,
  maxBarWidth: 4,
  barGap: 1,
  maxBufferWidth: 2048,
  maxBufferHeight: 256,
})

const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const size = ref({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function clamp01(value: number) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1)
}

function updateSize() {
  const el = containerRef.value
  if (!el)
    return
  size.value = {
    width: Math.max(el.clientWidth, 0),
    height: Math.max(el.clientHeight, 0),
  }
}

function drawWaveform() {
  const canvas = canvasRef.value
  if (!canvas)
    return

  const width = size.value.width
  const height = size.value.height
  if (width <= 0 || height <= 0)
    return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const targetBufferWidth = clamp(Math.round(width * dpr), 1, props.maxBufferWidth)
  const targetBufferHeight = clamp(Math.round(height * dpr), 1, props.maxBufferHeight)

  if (canvas.width !== targetBufferWidth)
    canvas.width = targetBufferWidth
  if (canvas.height !== targetBufferHeight)
    canvas.height = targetBufferHeight

  const ctx = canvas.getContext('2d')
  if (!ctx)
    return

  const scaleX = targetBufferWidth / width
  const scaleY = targetBufferHeight / height
  ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const peaks = props.peaks
  if (!peaks.length)
    return

  const bandWidth = width / peaks.length
  if (!Number.isFinite(bandWidth) || bandWidth <= 0)
    return

  const gap = Math.min(props.barGap, Math.max(0, bandWidth - 0.1))
  ctx.fillStyle = props.barColor

  for (let i = 0; i < peaks.length; i++) {
    const bandStart = i * bandWidth
    const bandEnd = bandStart + bandWidth
    const innerStart = bandStart + gap / 2
    const innerEnd = bandEnd - gap / 2
    const availableWidth = innerEnd - innerStart
    if (availableWidth <= 0)
      continue

    const drawWidth = Math.min(props.maxBarWidth, availableWidth)
    const x = innerStart + (availableWidth - drawWidth) / 2

    const peak = clamp01(peaks[i] ?? 0)
    const barHeight = Math.max(props.minBarHeight, peak * height * 0.88)
    const y = (height - barHeight) / 2
    ctx.fillRect(x, y, drawWidth, barHeight)
  }
}

onMounted(() => {
  updateSize()
  const el = containerRef.value
  if (!el)
    return
  resizeObserver = new ResizeObserver(() => {
    updateSize()
  })
  resizeObserver.observe(el)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(
  [
    () => props.peaks,
    () => props.barColor,
    () => props.minBarHeight,
    () => props.maxBarWidth,
    () => props.barGap,
    () => props.maxBufferWidth,
    () => props.maxBufferHeight,
    () => size.value.width,
    () => size.value.height,
  ],
  async () => {
    await nextTick()
    drawWaveform()
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <div ref="containerRef" class="waveform-canvas-strip">
    <canvas ref="canvasRef" class="waveform-canvas-strip__canvas" />
  </div>
</template>

<style scoped>
.waveform-canvas-strip {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.waveform-canvas-strip__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
