<script setup lang="ts">
import type { IAudioSegment } from '@video-editor/shared'
import type { WaveformData } from '@video-editor/protocol'
import { extractWaveform } from '@video-editor/protocol'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

defineOptions({ name: 'AudioSegment' })

const props = defineProps<{
  segment: IAudioSegment
}>()

const containerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(0)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
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

// Compute visible peaks and coverage based on segment trim settings
const waveformDisplay = computed(() => {
  if (!waveformState.data)
    return { peaks: [], coveragePercent: 100 }

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

  return { peaks: visiblePeaks, coveragePercent }
})
</script>

<template>
  <div ref="containerRef" class="audio-segment">
    <div
      class="audio-segment__waveform"
      :style="{ width: `${waveformDisplay.coveragePercent}%` }"
    >
      <template v-if="waveformState.data && waveformDisplay.peaks.length">
        <div
          v-for="(peak, index) in waveformDisplay.peaks"
          :key="index"
          class="waveform-bar"
          :style="{
            height: `${Math.max(4, peak * 80)}%`,
          }"
        />
      </template>
      <template v-else-if="waveformState.loading">
        <div class="waveform-placeholder">
          <span>加载波形…</span>
        </div>
      </template>
      <template v-else-if="waveformState.error">
        <div class="waveform-placeholder">
          <span>波形加载失败</span>
        </div>
      </template>
      <template v-else>
        <div class="waveform-pattern" />
      </template>
    </div>
    <div class="audio-segment__info">
      <span class="audio-segment__label">
        {{ segment.extra?.label || 'Audio' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
:where(.audio-segment) {
  --at-apply: relative flex items-center w-full h-full overflow-hidden rounded-4px;
  background-color: color-mix(in srgb, var(--ve-segment-accent, #0ea5e9) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--ve-segment-accent, #0ea5e9) 30%, transparent);
}

:where(.audio-segment .audio-segment__waveform) {
  --at-apply: absolute top-0 bottom-0 left-0 flex items-center justify-start gap-[1px] px-1;
  overflow: hidden;
}

:where(.audio-segment .waveform-bar) {
  --at-apply: flex-1;
  min-width: 1px;
  max-width: 4px;
  min-height: 4px;
  background-color: var(--ve-segment-accent, #0ea5e9);
  border-radius: 1px;
  opacity: 0.6;
}

:where(.audio-segment .waveform-placeholder) {
  --at-apply: flex items-center justify-center w-full h-full text-xs;
  color: var(--ve-segment-accent, #0ea5e9);
  opacity: 0.6;
}

:where(.audio-segment .waveform-pattern) {
  width: 100%;
  height: 100%;
  background-image: linear-gradient(
    90deg,
    transparent 45%,
    var(--ve-segment-accent, #0ea5e9) 45%,
    var(--ve-segment-accent, #0ea5e9) 55%,
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

:where(.audio-segment .audio-segment__info) {
  --at-apply: relative z-10 px-2 py-1 text-xs font-medium truncate;
  color: var(--ve-segment-accent, #0ea5e9);
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
}
</style>
