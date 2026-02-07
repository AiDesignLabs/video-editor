<script setup lang="ts">
import type { IAudioSegment } from '@video-editor/shared'
import type { WaveformData } from '@video-editor/protocol'
import { extractWaveform } from '@video-editor/protocol'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import WaveformCanvasStrip from './WaveformCanvasStrip.vue'

defineOptions({ name: 'AudioSegment' })

const props = defineProps<{
  segment: IAudioSegment
}>()

const containerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(0)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth.value = entry.contentRect.width
      }
    })
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

interface WaveformState {
  data: WaveformData | null
  loading: boolean
  error: string | null
  loadedUrl: string | null
}

const waveformState = reactive<WaveformState>({
  data: null,
  loading: false,
  error: null,
  loadedUrl: null,
})

let currentJobId = 0

// Only reload waveform when URL changes
watch(() => props.segment.url, (url, prevUrl) => {
  if (url && url !== prevUrl) {
    void loadWaveform(url)
  }
}, { immediate: true })

async function loadWaveform(url: string) {
  if (!url)
    return

  // Skip if already loaded for this URL
  if (waveformState.loadedUrl === url && waveformState.data)
    return

  const jobId = ++currentJobId
  waveformState.loading = true
  waveformState.error = null

  try {
    // Use 1000 samples as a good balance:
    // - Provides enough detail for long audio files (up to ~5min)
    // - Not too heavy for processing/memory (~4KB of data)
    // - Cached per URL so only computed once
    const data = await extractWaveform(url, { samples: 1000 })
    if (currentJobId !== jobId)
      return

    waveformState.data = data
    waveformState.loadedUrl = url
    waveformState.loading = false
  }
  catch (err) {
    if (currentJobId !== jobId)
      return
    waveformState.error = err instanceof Error ? err.message : String(err)
    waveformState.loading = false
  }
}

const WAVEFORM_BAR_MIN_WIDTH = 1
const WAVEFORM_BAR_GAP = 1
const MAX_WAVEFORM_BARS = 4096

function downsamplePeaks(peaks: number[], targetCount: number) {
  if (targetCount >= peaks.length)
    return peaks

  const nextPeaks: number[] = []
  const windowSize = peaks.length / targetCount

  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * windowSize)
    const end = Math.max(start + 1, Math.ceil((i + 1) * windowSize))
    let maxPeak = 0
    for (let j = start; j < end; j++) {
      const peak = peaks[j] ?? 0
      if (peak > maxPeak)
        maxPeak = peak
    }
    nextPeaks.push(maxPeak)
  }

  return nextPeaks
}

// Compute visible peaks and coverage based on segment trim settings
const waveformDisplay = computed(() => {
  if (!waveformState.data)
    return { peaks: [], renderPeaks: [], coveragePercent: 100 }

  const segment = props.segment
  const fullDurationMs = waveformState.data.duration * 1000
  const peaks = waveformState.data.peaks

  const fromTime = segment.fromTime ?? 0
  const segmentDuration = segment.endTime - segment.startTime
  const playRate = segment.playRate ?? 1

  // How much source audio time this segment needs
  const neededSourceDuration = segmentDuration * playRate

  // Available source audio from fromTime to end
  const availableSourceDuration = Math.max(0, fullDurationMs - fromTime)

  // Actual source duration we can use (capped by available audio)
  const actualSourceDuration = Math.min(neededSourceDuration, availableSourceDuration)

  // Coverage: what percentage of segment width the waveform should occupy
  const coveragePercent = segmentDuration > 0
    ? Math.min(100, (actualSourceDuration / playRate / segmentDuration) * 100)
    : 0

  // Calculate peak indices for the portion we're showing
  const startRatio = fromTime / fullDurationMs
  const endRatio = (fromTime + actualSourceDuration) / fullDurationMs

  const startIdx = Math.floor(startRatio * peaks.length)
  const endIdx = Math.ceil(endRatio * peaks.length)

  const visiblePeaks = peaks.slice(
    Math.max(0, startIdx),
    Math.min(peaks.length, endIdx),
  )

  if (!visiblePeaks.length)
    return { peaks: [], renderPeaks: [], coveragePercent }

  const renderWidth = containerWidth.value * (coveragePercent / 100)
  const barsByWidth = renderWidth > 0
    ? Math.min(
        MAX_WAVEFORM_BARS,
        Math.max(1, Math.floor(renderWidth / (WAVEFORM_BAR_MIN_WIDTH + WAVEFORM_BAR_GAP))),
      )
    : visiblePeaks.length

  return {
    peaks: visiblePeaks,
    renderPeaks: downsamplePeaks(visiblePeaks, barsByWidth),
    coveragePercent,
  }
})
</script>

<template>
  <div ref="containerRef" class="audio-segment">
    <!-- Waveform with data -->
    <template v-if="waveformState.data && waveformDisplay.renderPeaks.length">
      <slot
        name="waveform"
        :segment="segment"
        :waveform="waveformState.data"
        :peaks="waveformDisplay.renderPeaks"
        :raw-peaks="waveformDisplay.peaks"
        :coverage-percent="waveformDisplay.coveragePercent"
      >
        <div
          class="audio-segment__waveform"
          :style="{ width: `${waveformDisplay.coveragePercent}%` }"
        >
          <WaveformCanvasStrip
            class="audio-segment__waveform-canvas"
            :peaks="waveformDisplay.renderPeaks"
            bar-color="#2B2B2B"
            :min-bar-height="4"
            :max-bar-width="4"
            :bar-gap="1"
          />
        </div>
      </slot>
    </template>

    <!-- Placeholder states -->
    <div v-else class="audio-segment__placeholder">
      <slot v-if="waveformState.loading" name="loading" :segment="segment">
        <span>加载波形…</span>
      </slot>
      <slot v-else-if="waveformState.error" name="error" :segment="segment" :error="waveformState.error">
        <span>波形加载失败</span>
      </slot>
      <slot v-else name="empty" :segment="segment">
        <div class="waveform-pattern" />
      </slot>
    </div>

    <!-- Overlay (badge, labels, etc.) -->
    <slot name="overlay" :segment="segment">
      <span v-if="segment.extra?.label" class="audio-segment__badge">
        {{ segment.extra?.label }}
      </span>
    </slot>
  </div>
</template>

<style scoped>
:where(.audio-segment) {
  --at-apply: relative flex items-center w-full h-full overflow-hidden rounded-4px;
  background-color: #EFEFEF;
}

:where(.audio-segment .audio-segment__waveform) {
  --at-apply: absolute top-0 bottom-0 left-0 flex items-center justify-start gap-[1px];
  overflow: hidden;
}

:where(.audio-segment .audio-segment__waveform-canvas) {
  --at-apply: w-full h-full;
}

:where(.audio-segment .audio-segment__placeholder) {
  --at-apply: flex items-center justify-center w-full h-full text-xs;
  color: #2B2B2B;
  opacity: 0.6;
}

:where(.audio-segment .waveform-pattern) {
  width: 100%;
  height: 100%;
  background-image: linear-gradient(
    90deg,
    transparent 45%,
    #2B2B2B 45%,
    #2B2B2B 55%,
    transparent 55%
  );
  background-size: 4px 100%;
  background-position: 0 center;
  mask-image: linear-gradient(
    to bottom,
    transparent 10%,
    black 40%,
    black 60%,
    transparent 90%
  );
  opacity: 0.4;
}

:where(.audio-segment .audio-segment__badge) {
  --at-apply: absolute top-1.5 left-2 px-1.5 py-0.5 text-[11px] rounded-4px pointer-events-none;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  transform-origin: left top;
  transform: scale(0.9);
}
</style>
