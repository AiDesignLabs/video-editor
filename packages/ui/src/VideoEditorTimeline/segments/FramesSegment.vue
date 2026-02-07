<script setup lang="ts">
import type { IFramesSegmentUnion, IVideoFramesSegment } from '@video-editor/shared'
import type { WaveformData } from '@video-editor/protocol'
import { extractWaveform, generateThumbnails } from '@video-editor/protocol'
import { isVideoFramesSegment } from '@video-editor/shared'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import WaveformCanvasStrip from './WaveformCanvasStrip.vue'

defineOptions({ name: 'FramesSegment' })

const props = defineProps<{
  segment: IFramesSegmentUnion
}>()

const containerRef = ref<HTMLElement | null>(null)
const waveformRef = ref<HTMLElement | null>(null)
const imageCount = ref(1)
const waveformWidth = ref(0)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === containerRef.value) {
        const nextCount = Math.max(1, Math.ceil(entry.contentRect.width / 56))
        if (imageCount.value !== nextCount)
          imageCount.value = nextCount
      }

      if (entry.target === waveformRef.value)
        waveformWidth.value = entry.contentRect.width
    }
  })

  if (containerRef.value)
    resizeObserver.observe(containerRef.value)

  if (waveformRef.value) {
    waveformWidth.value = waveformRef.value.clientWidth
    resizeObserver.observe(waveformRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cleanupThumbnails()
})

watch(waveformRef, (el, prevEl) => {
  if (resizeObserver && prevEl)
    resizeObserver.unobserve(prevEl)
  if (resizeObserver && el) {
    waveformWidth.value = el.clientWidth
    resizeObserver.observe(el)
  }
})

interface ThumbnailPreview { tsMs: number, url: string }
interface ThumbnailState { items: ThumbnailPreview[], loading: boolean, error: string | null }
interface WaveformState {
  data: WaveformData | null
  loading: boolean
  error: string | null
  loadedUrl: string | null
}

const thumbnailState = reactive<ThumbnailState>({ items: [], loading: false, error: null })
const waveformState = reactive<WaveformState>({
  data: null,
  loading: false,
  error: null,
  loadedUrl: null,
})
let currentJobId = 0
let currentWaveformJobId = 0
let refreshTimer: number | undefined
let pendingSegment: IVideoFramesSegment | null = null

watch(() => props.segment, (segment, prev) => {
  if (!isVideoFramesSegment(segment as IFramesSegmentUnion))
    return
  const shouldRefresh = !prev || hasVideoSegmentChanged(prev as IVideoFramesSegment, segment as IVideoFramesSegment)
  if (shouldRefresh)
    scheduleThumbnailRefresh(segment as IVideoFramesSegment, prev as IVideoFramesSegment | undefined)
}, { immediate: true, deep: true })

watch(() => props.segment, (segment, prev) => {
  if (!isVideoFramesSegment(segment as IFramesSegmentUnion))
    return
  const video = segment as IVideoFramesSegment
  const prevVideo = prev && isVideoFramesSegment(prev as IFramesSegmentUnion) ? prev as IVideoFramesSegment : undefined
  if (video.url && video.url !== prevVideo?.url)
    void loadVideoWaveform(video.url)
}, { immediate: true, deep: true })

function hasVideoSegmentChanged(prev: IVideoFramesSegment, next: IVideoFramesSegment) {
  return prev.url !== next.url
    || prev.startTime !== next.startTime
    || prev.endTime !== next.endTime
    || prev.fromTime !== next.fromTime
}

function scheduleThumbnailRefresh(segment: IVideoFramesSegment, prev?: IVideoFramesSegment) {
  const urlChanged = !prev || prev.url !== segment.url
  const fromChanged = !prev || prev.fromTime !== segment.fromTime
  const immediate = urlChanged || fromChanged
  pendingSegment = segment
  if (refreshTimer) {
    window.clearTimeout(refreshTimer)
    refreshTimer = undefined
  }
  if (immediate) {
    void loadVideoThumbnails(segment)
    return
  }
  refreshTimer = window.setTimeout(() => {
    if (pendingSegment)
      void loadVideoThumbnails(pendingSegment)
    refreshTimer = undefined
  }, 240)
}

async function loadVideoThumbnails(segment: IVideoFramesSegment) {
  if (!segment.url)
    return

  const jobId = ++currentJobId
  cleanupThumbnails()
  thumbnailState.loading = true
  thumbnailState.error = null

  try {
    const options = buildThumbnailOptions(segment)
    const shots = await generateThumbnails(segment.url, options)
    if (currentJobId !== jobId)
      return

    const previews = shots.map(thumb => ({
      tsMs: Math.round(thumb.ts / 1000),
      url: URL.createObjectURL(thumb.img),
    }))
    thumbnailState.items = previews
    thumbnailState.loading = false
  }
  catch (err) {
    if (currentJobId !== jobId)
      return
    thumbnailState.error = err instanceof Error ? err.message : String(err)
    thumbnailState.loading = false
  }
}

async function loadVideoWaveform(url: string) {
  if (!url)
    return

  if (waveformState.loadedUrl === url && waveformState.data)
    return

  const jobId = ++currentWaveformJobId
  waveformState.loading = true
  waveformState.error = null

  try {
    const data = await extractWaveform(url, { samples: 1000 })
    if (currentWaveformJobId !== jobId)
      return
    waveformState.data = data
    waveformState.loadedUrl = url
    waveformState.loading = false
  }
  catch (err) {
    if (currentWaveformJobId !== jobId)
      return
    waveformState.data = null
    waveformState.error = err instanceof Error ? err.message : String(err)
    waveformState.loading = false
  }
}

function buildThumbnailOptions(segment: IVideoFramesSegment) {
  const startUs = Math.max(segment.fromTime ?? 0, 0) * 1000
  const durationMs = Math.max(segment.endTime - segment.startTime, 1)
  const endUs = startUs + durationMs * 1000
  const targetThumbs = 8
  const stepUs = Math.max(Math.floor((endUs - startUs) / targetThumbs), 200_000)
  return { start: startUs, end: endUs, step: stepUs }
}

function cleanupThumbnails() {
  thumbnailState.items.forEach(thumb => URL.revokeObjectURL(thumb.url))
  thumbnailState.items = []
}

const WAVEFORM_BAR_MIN_WIDTH = 1
const WAVEFORM_BAR_GAP = 1
const MAX_WAVEFORM_BARS = 4096

const videoWaveformDisplay = computed(() => {
  if (!isVideoFramesSegment(props.segment))
    return { peaks: [], coveragePercent: 100 }
  if (!waveformState.data)
    return { peaks: [], coveragePercent: 100 }

  const segment = props.segment
  const segmentDuration = Math.max(segment.endTime - segment.startTime, 0)
  if (segmentDuration <= 0)
    return { peaks: [], coveragePercent: 100 }

  const renderWidth = Math.max(waveformWidth.value, 1)
  const barsByWidth = Math.min(
    MAX_WAVEFORM_BARS,
    Math.max(1, Math.floor(renderWidth / (WAVEFORM_BAR_MIN_WIDTH + WAVEFORM_BAR_GAP))),
  )

  const fullDurationMs = waveformState.data.duration * 1000
  const peaks = waveformState.data.peaks
  if (!Number.isFinite(fullDurationMs) || fullDurationMs <= 0 || peaks.length === 0)
    return { peaks: new Array(barsByWidth).fill(0), coveragePercent: 100 }

  const sourceStartMs = Math.max(segment.fromTime ?? 0, 0)
  const playRate = Math.max(segment.playRate ?? 1, 0.0001)
  const sourceSpanMs = segmentDuration * playRate

  const sampledPeaks: number[] = []
  for (let i = 0; i < barsByWidth; i++) {
    const barStartMs = sourceStartMs + (sourceSpanMs * i) / barsByWidth
    const barEndMs = sourceStartMs + (sourceSpanMs * (i + 1)) / barsByWidth

    // Out-of-range source window means silent tail.
    if (barStartMs >= fullDurationMs || barEndMs <= 0) {
      sampledPeaks.push(0)
      continue
    }

    const safeStart = Math.max(barStartMs, 0)
    const safeEnd = Math.min(barEndMs, fullDurationMs)
    const startIdx = Math.floor((safeStart / fullDurationMs) * peaks.length)
    const endIdx = Math.max(startIdx + 1, Math.ceil((safeEnd / fullDurationMs) * peaks.length))

    let maxPeak = 0
    for (let j = startIdx; j < endIdx; j++) {
      const peak = peaks[j] ?? 0
      if (peak > maxPeak)
        maxPeak = peak
    }
    sampledPeaks.push(maxPeak)
  }

  return { peaks: sampledPeaks, coveragePercent: 100 }
})
</script>

<template>
  <div class="frames-segment">
    <!-- Image Type: Tiled background -->
    <template v-if="segment.type === 'image'">
      <slot name="image" :segment="segment" :style="{ backgroundImage: segment.url ? `url(${segment.url})` : '' }">
        <div ref="containerRef" class="frames-segment__image">
          <div
            v-for="i in imageCount"
            :key="i"
            class="frames-segment__image-item"
            :style="{ backgroundImage: segment.url ? `url(${segment.url})` : '' }"
          />
        </div>
      </slot>
    </template>

    <!-- Video Type: Extracted frame thumbnails -->
    <template v-else-if="segment.type === 'video'">
      <slot
        name="video"
        :segment="segment"
        :thumbnails="thumbnailState.items"
        :waveform-peaks="videoWaveformDisplay.peaks"
        :waveform-coverage-percent="videoWaveformDisplay.coveragePercent"
      >
        <div class="frames-segment__video-wrap">
          <div class="frames-segment__video">
            <template v-if="thumbnailState.items.length">
              <div
                v-for="thumb in thumbnailState.items"
                :key="`${segment.id}-${thumb.tsMs}`"
                class="frames-segment__thumb"
                :style="{ backgroundImage: `url(${thumb.url})` }"
              />
            </template>
            <div v-else class="frames-segment__placeholder frames-segment__placeholder--video">
              <slot v-if="thumbnailState.loading" name="loading" :segment="segment">
                <span>抽帧中…</span>
              </slot>
              <slot v-else-if="thumbnailState.error" name="error" :segment="segment" :error="thumbnailState.error">
                <span>生成失败</span>
              </slot>
              <slot v-else name="empty" :segment="segment">
                <span>未生成缩略图</span>
              </slot>
            </div>
          </div>
          <div ref="waveformRef" class="frames-segment__waveform-strip">
            <template v-if="videoWaveformDisplay.peaks.length">
              <div
                class="frames-segment__waveform"
                :style="{ width: '100%' }"
              >
                <WaveformCanvasStrip
                  class="frames-segment__waveform-canvas"
                  :peaks="videoWaveformDisplay.peaks"
                  bar-color="#3f3f46"
                  :min-bar-height="3"
                  :max-bar-width="4"
                  :bar-gap="1"
                />
              </div>
            </template>
            <div v-else class="frames-segment__waveform-pattern" />
          </div>
        </div>
      </slot>
    </template>

    <!-- 3D or other types -->
    <template v-else>
      <slot name="fallback" :segment="segment">
        <div class="frames-segment__placeholder">
          <span>{{ segment.type }}</span>
        </div>
      </slot>
    </template>

    <!-- Overlay (badge, labels, etc.) -->
    <slot name="overlay" :segment="segment">
      <span v-if="segment.extra?.label" class="frames-segment__badge">
        {{ segment.extra?.label }}
      </span>
    </slot>
  </div>
</template>

<style scoped>
:where(.frames-segment) {
  --at-apply: relative flex items-stretch w-full h-full overflow-hidden rounded-4px;
}

:where(.frames-segment .frames-segment__image) {
  --at-apply: flex w-full h-full overflow-hidden rounded-4px;
  background-color: color-mix(in srgb, var(--ve-segment-accent, #222226) 15%, transparent);
}

:where(.frames-segment .frames-segment__image-item) {
  --at-apply: flex-shrink-0 w-14 h-full bg-cover bg-left-center bg-no-repeat;
}

:where(.frames-segment .frames-segment__video) {
  --at-apply: flex items-center w-full h-full overflow-hidden;
  background: #f1f5f9;
}

:where(.frames-segment .frames-segment__video-wrap) {
  --at-apply: relative w-full h-full;
}

:where(.frames-segment .frames-segment__thumb) {
  --at-apply: flex-1 min-w-14;
  aspect-ratio: 1 / 1;
  background-size: cover;
  background-position: center;
}

:where(.frames-segment .frames-segment__waveform-strip) {
  --at-apply: absolute left-0 right-0 bottom-0 flex items-center w-full px-1 overflow-hidden;
  height: 16px;
  background: #e5e5e8;
  z-index: 2;
}

:where(.frames-segment .frames-segment__waveform) {
  --at-apply: absolute top-0 bottom-0 left-0 flex items-center gap-[1px];
  overflow: hidden;
}

:where(.frames-segment .frames-segment__waveform-canvas) {
  --at-apply: w-full h-full;
}

:where(.frames-segment .frames-segment__waveform-pattern) {
  width: 100%;
  height: 100%;
  background-image: linear-gradient(
    90deg,
    transparent 45%,
    #52525b 45%,
    #52525b 55%,
    transparent 55%
  );
  background-size: 4px 100%;
  background-position: 0 center;
  mask-image: linear-gradient(
    to bottom,
    transparent 10%,
    black 35%,
    black 65%,
    transparent 90%
  );
  opacity: 0.4;
}

:where(.frames-segment .frames-segment__placeholder) {
  --at-apply: flex items-center justify-center w-full h-full text-[12px] rounded-4px whitespace-nowrap;
  color: rgba(15, 23, 42, 0.75);
  background: rgba(0, 0, 0, 0.05);
}

:where(.frames-segment .frames-segment__placeholder--video) {
  border-radius: 0;
}

:where(.frames-segment .frames-segment__badge) {
  --at-apply: absolute top-1.5 left-2 px-1.5 py-0.5 text-[11px] rounded-4px pointer-events-none;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  transform-origin: left top;
  transform: scale(0.9);
}
</style>
