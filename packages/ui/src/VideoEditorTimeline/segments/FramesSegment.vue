<script setup lang="ts">
import type { WaveformData } from '@video-editor/protocol'
import type { IFramesSegmentUnion } from '@video-editor/shared'
import type { VideoThumbnailExtractionDiagnostics, VideoThumbnailRequest } from './videoThumbnailExtractionModel'
import { extractWaveform, generateThumbnails, getMp4Meta } from '@video-editor/protocol'
import { isVideoFramesSegment } from '@video-editor/shared'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { createVideoThumbnailExtractionDiagnostics, videoThumbnailExtractionModel } from './videoThumbnailExtractionModel'
import WaveformCanvasStrip from './WaveformCanvasStrip.vue'

defineOptions({ name: 'FramesSegment' })

const props = defineProps<{
  segment: IFramesSegmentUnion
}>()
const emit = defineEmits<{
  (e: 'toggle-video-mute', payload: { segmentId: string, muted: boolean }): void
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
  cancelThumbnailWork()
  currentWaveformJobId += 1
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
interface WaveformState {
  data: WaveformData | null
  hasAudio: boolean | null
  loading: boolean
  error: string | null
  loadedUrl: string | null
}

const thumbnailItems = ref<ThumbnailPreview[]>([])
const thumbnailDiagnostics = reactive<VideoThumbnailExtractionDiagnostics>(createVideoThumbnailExtractionDiagnostics())
const waveformState = reactive<WaveformState>({
  data: null,
  hasAudio: null,
  loading: false,
  error: null,
  loadedUrl: null,
})
let currentJobId = 0
let currentWaveformJobId = 0
let refreshTimer: number | undefined
let pendingThumbnailRequest: VideoThumbnailRequest | null = null

watch(() => {
  if (!isVideoFramesSegment(props.segment))
    return null
  return videoThumbnailExtractionModel.createRequest(props.segment)
}, (request, previousRequest) => {
  if (!request?.url) {
    cancelThumbnailWork()
    return
  }
  scheduleThumbnailRefresh(request, previousRequest)
}, { immediate: true })

watch(() => isVideoFramesSegment(props.segment) ? props.segment.url : '', (url, previousUrl) => {
  if (url && url !== previousUrl)
    void loadVideoWaveform(url)
}, { immediate: true })

function scheduleThumbnailRefresh(request: VideoThumbnailRequest, previousRequest: VideoThumbnailRequest | null | undefined) {
  const urlChanged = !previousRequest || previousRequest.url !== request.url
  const fromChanged = !previousRequest || previousRequest.fromTime !== request.fromTime
  const immediate = urlChanged || fromChanged
  pendingThumbnailRequest = request
  if (refreshTimer) {
    window.clearTimeout(refreshTimer)
    refreshTimer = undefined
  }
  if (immediate) {
    void loadVideoThumbnails(request)
    return
  }
  refreshTimer = window.setTimeout(() => {
    if (pendingThumbnailRequest)
      void loadVideoThumbnails(pendingThumbnailRequest)
    refreshTimer = undefined
  }, 240)
}

async function loadVideoThumbnails(request: VideoThumbnailRequest) {
  const jobId = ++currentJobId
  cleanupThumbnails()
  const startedAt = readThumbnailClock()
  let extractionStartedAt: number | undefined
  Object.assign(thumbnailDiagnostics, createVideoThumbnailExtractionDiagnostics(), {
    requestId: jobId,
    stage: 'metadata',
    status: 'loading',
  } satisfies Partial<VideoThumbnailExtractionDiagnostics>)

  try {
    const metadata = await getMp4Meta(request.url)
    if (currentJobId !== jobId)
      return

    const options = videoThumbnailExtractionModel.resolveOptions(request, metadata.durationUs)
    extractionStartedAt = readThumbnailClock()
    thumbnailDiagnostics.metadataDurationMs = resolveThumbnailDuration(startedAt, extractionStartedAt)
    thumbnailDiagnostics.sourceDurationMs = Math.round(metadata.durationUs / 1000)
    thumbnailDiagnostics.requestedStartUs = options.start
    thumbnailDiagnostics.requestedEndUs = options.end
    thumbnailDiagnostics.requestedStepUs = options.step
    thumbnailDiagnostics.stage = 'extracting'
    const shots = await generateThumbnails(request.url, options)
    if (currentJobId !== jobId)
      return

    const previews = shots.map(thumb => ({
      tsMs: Math.round(thumb.ts / 1000),
      url: URL.createObjectURL(thumb.img),
    }))
    const completedAt = readThumbnailClock()
    thumbnailItems.value = previews
    thumbnailDiagnostics.extractionDurationMs = resolveThumbnailDuration(extractionStartedAt, completedAt)
    thumbnailDiagnostics.totalDurationMs = resolveThumbnailDuration(startedAt, completedAt)
    thumbnailDiagnostics.resultCount = previews.length
    thumbnailDiagnostics.stage = 'complete'
    thumbnailDiagnostics.status = previews.length > 0 ? 'ready' : 'empty'
  }
  catch (err) {
    if (currentJobId !== jobId)
      return
    const failedAt = readThumbnailClock()
    if (thumbnailDiagnostics.stage === 'metadata')
      thumbnailDiagnostics.metadataDurationMs = resolveThumbnailDuration(startedAt, failedAt)
    if (thumbnailDiagnostics.stage === 'extracting' && extractionStartedAt !== undefined)
      thumbnailDiagnostics.extractionDurationMs = resolveThumbnailDuration(extractionStartedAt, failedAt)
    thumbnailDiagnostics.error = err instanceof Error ? err.message : String(err)
    thumbnailDiagnostics.errorName = err instanceof Error ? err.name : undefined
    thumbnailDiagnostics.errorStack = err instanceof Error ? err.stack : undefined
    thumbnailDiagnostics.totalDurationMs = resolveThumbnailDuration(startedAt, failedAt)
    thumbnailDiagnostics.resultCount = 0
    thumbnailDiagnostics.status = 'error'
  }
}

function readThumbnailClock() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function resolveThumbnailDuration(startedAt: number, completedAt: number) {
  return Math.round(Math.max(0, completedAt - startedAt))
}

async function loadVideoWaveform(url: string) {
  if (!url)
    return

  if (waveformState.loadedUrl === url && (waveformState.data || waveformState.hasAudio === false))
    return

  const jobId = ++currentWaveformJobId
  if (waveformState.loadedUrl !== url) {
    waveformState.data = null
    waveformState.hasAudio = null
  }
  waveformState.loading = true
  waveformState.error = null

  try {
    const meta = await getMp4Meta(url)
    if (currentWaveformJobId !== jobId)
      return

    const hasAudio = (meta.audioChanCount ?? 0) > 0
    waveformState.hasAudio = hasAudio
    if (!hasAudio) {
      waveformState.data = null
      waveformState.loadedUrl = url
      waveformState.loading = false
      return
    }

    const data = await extractWaveform(url, { samples: 1000 })
    if (currentWaveformJobId !== jobId)
      return
    waveformState.data = data
    waveformState.hasAudio = true
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

function cleanupThumbnails() {
  thumbnailItems.value.forEach(thumb => URL.revokeObjectURL(thumb.url))
  thumbnailItems.value = []
}

function cancelThumbnailWork() {
  currentJobId += 1
  pendingThumbnailRequest = null
  if (refreshTimer) {
    window.clearTimeout(refreshTimer)
    refreshTimer = undefined
  }
  cleanupThumbnails()
  Object.assign(thumbnailDiagnostics, createVideoThumbnailExtractionDiagnostics())
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

const shouldShowWaveformStrip = computed(() => waveformState.hasAudio !== false)
const hasOverlayLabel = computed(() => Boolean(props.segment.extra?.label))
const shouldShowMuteButton = computed(() => {
  return isVideoFramesSegment(props.segment) && waveformState.hasAudio !== false
})
const mutedOverride = ref<boolean | null>(null)
const isMutedFromSegment = computed(() => {
  if (!isVideoFramesSegment(props.segment))
    return false
  return (props.segment.volume ?? 1) <= 0
})
const isMuted = computed(() => mutedOverride.value ?? isMutedFromSegment.value)

watch(() => props.segment.id, () => {
  mutedOverride.value = null
})

watch(() => {
  if (!isVideoFramesSegment(props.segment))
    return undefined
  return props.segment.volume
}, () => {
  mutedOverride.value = null
})

function handleMuteToggle(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!isVideoFramesSegment(props.segment))
    return
  const nextMuted = !isMuted.value
  mutedOverride.value = nextMuted
  emit('toggle-video-mute', {
    segmentId: props.segment.id,
    muted: nextMuted,
  })
}
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
        :thumbnails="thumbnailItems"
        :thumbnail-diagnostics="thumbnailDiagnostics"
        :waveform-peaks="videoWaveformDisplay.peaks"
        :waveform-coverage-percent="videoWaveformDisplay.coveragePercent"
      >
        <div class="frames-segment__video-wrap">
          <div class="frames-segment__video">
            <template v-if="thumbnailItems.length">
              <div
                v-for="thumb in thumbnailItems"
                :key="`${segment.id}-${thumb.tsMs}`"
                class="frames-segment__thumb"
                :style="{ backgroundImage: `url(${thumb.url})` }"
              />
            </template>
            <div v-else class="frames-segment__placeholder frames-segment__placeholder--video">
              <slot v-if="thumbnailDiagnostics.status === 'loading'" name="loading" :segment="segment">
                <span>抽帧中…</span>
              </slot>
              <slot v-else-if="thumbnailDiagnostics.status === 'error'" name="error" :segment="segment" :error="thumbnailDiagnostics.error">
                <span>生成失败</span>
              </slot>
              <slot v-else name="empty" :segment="segment">
                <span>未生成缩略图</span>
              </slot>
            </div>
          </div>
          <div
            v-if="shouldShowWaveformStrip"
            ref="waveformRef"
            class="frames-segment__waveform-strip"
            :class="{ 'frames-segment__waveform-strip--muted': isMuted }"
          >
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
    <slot
      name="overlay"
      :segment="segment"
      :is-muted="isMuted"
      :toggle-mute="handleMuteToggle"
      :show-mute-button="shouldShowMuteButton"
    >
      <div v-if="hasOverlayLabel || shouldShowMuteButton" class="frames-segment__overlay">
        <span v-if="segment.extra?.label" class="frames-segment__badge">
          {{ segment.extra?.label }}
        </span>
        <button
          v-if="shouldShowMuteButton"
          type="button"
          class="frames-segment__mute-btn"
          :aria-label="isMuted ? '取消静音视频片段' : '静音视频片段'"
          :title="isMuted ? '取消静音' : '静音'"
          @click.stop="handleMuteToggle"
          @pointerdown.stop
          @dblclick.stop
        >
          <span v-if="isMuted" class="frames-segment__mute-icon i-creatly-mute" aria-hidden="true" />
          <span v-else class="frames-segment__mute-icon i-creatly-sound" aria-hidden="true" />
        </button>
      </div>
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
  background: var(--ve-surface-control-subtle);
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
  background: var(--ve-surface-control-muted);
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
}

:where(.frames-segment .frames-segment__waveform-strip--muted .frames-segment__waveform) {
  opacity: 0.25;
}

:where(.frames-segment .frames-segment__waveform-strip--muted .frames-segment__waveform-pattern) {
  opacity: 0.25;
}

:where(.frames-segment .frames-segment__placeholder) {
  --at-apply: flex items-center justify-center w-full h-full text-[12px] rounded-4px whitespace-nowrap;
  color: var(--ve-content-secondary);
  background: var(--ve-surface-control-subtle);
}

:where(.frames-segment .frames-segment__placeholder--video) {
  border-radius: 0;
}

:where(.frames-segment .frames-segment__overlay) {
  --at-apply: absolute top-1.5 left-2 flex items-center gap-2 z-3;
}

:where(.frames-segment .frames-segment__badge) {
  --at-apply: px-1.5 py-0.5 text-[11px] rounded-4px pointer-events-none;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  transform-origin: left top;
  transform: scale(0.9);
}

:where(.frames-segment) .frames-segment__mute-btn {
  --at-apply: flex items-center justify-center rounded-4px border-none p-0 cursor-pointer text-white w-5 h-5 bg-[rgba(0,0,0,0.25)] hover:bg-[rgba(0,0,0,0.35)] focus-visible:outline-[2px] focus-visible:outline-[rgba(255,255,255,0.85)] focus-visible:outline-offset-[1px];
}

:where(.frames-segment) .frames-segment__mute-icon {
  --at-apply: block text-white w-3 h-3;
}
</style>
