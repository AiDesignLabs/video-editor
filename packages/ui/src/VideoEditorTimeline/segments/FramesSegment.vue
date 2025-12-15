<script setup lang="ts">
import type { IFramesSegmentUnion, IVideoFramesSegment } from '@video-editor/shared'
import { generateThumbnails } from '@video-editor/protocol'
import { isVideoFramesSegment } from '@video-editor/shared'
import { onBeforeUnmount, reactive, watch } from 'vue'

defineOptions({ name: 'FramesSegment' })

const props = defineProps<{
  segment: IFramesSegmentUnion
}>()

interface ThumbnailPreview { tsMs: number, url: string }
interface ThumbnailState { items: ThumbnailPreview[], loading: boolean, error: string | null }

const thumbnailState = reactive<ThumbnailState>({ items: [], loading: false, error: null })
let currentJobId = 0

watch(() => props.segment, (segment, prev) => {
  if (!isVideoFramesSegment(segment as IFramesSegmentUnion))
    return
  const shouldRefresh = !prev || hasVideoSegmentChanged(prev as IVideoFramesSegment, segment as IVideoFramesSegment)
  if (shouldRefresh)
    loadVideoThumbnails(segment as IVideoFramesSegment)
}, { immediate: true, deep: true })

onBeforeUnmount(() => {
  cleanupThumbnails()
})

function hasVideoSegmentChanged(prev: IVideoFramesSegment, next: IVideoFramesSegment) {
  return prev.url !== next.url
    || prev.startTime !== next.startTime
    || prev.endTime !== next.endTime
    || prev.fromTime !== next.fromTime
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

function getImageStyle() {
  return {
    backgroundImage: props.segment.url ? `url(${props.segment.url})` : '',
    backgroundRepeat: 'repeat-x',
    backgroundSize: '56px 56px',
    backgroundPosition: 'left center',
  }
}
</script>

<template>
  <div class="frames-segment">
    <!-- Image Type: Tiled background -->
    <template v-if="segment.type === 'image'">
      <slot name="image" :segment="segment" :style="getImageStyle()">
        <div
          class="frames-segment__image"
          :style="getImageStyle()"
        />
      </slot>
    </template>

    <!-- Video Type: Extracted frame thumbnails -->
    <template v-else-if="segment.type === 'video'">
      <template v-if="thumbnailState.items.length">
        <slot name="video" :segment="segment" :thumbnails="thumbnailState.items">
          <div class="frames-segment__video">
            <div
              v-for="thumb in thumbnailState.items"
              :key="`${segment.id}-${thumb.tsMs}`"
              class="frames-segment__thumb"
              :style="{ backgroundImage: `url(${thumb.url})` }"
            />
          </div>
        </slot>
      </template>
      <div v-else class="frames-segment__placeholder">
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
  --at-apply: w-full h-full rounded-4px;
  background-color: color-mix(in srgb, var(--ve-segment-accent, #222226) 15%, transparent);
}

:where(.frames-segment .frames-segment__video) {
  --at-apply: flex items-center w-full h-full overflow-hidden;
  background: #f1f5f9;
}

:where(.frames-segment .frames-segment__thumb) {
  --at-apply: flex-1 min-w-14;
  aspect-ratio: 1 / 1;
  background-size: cover;
  background-position: center;
}

:where(.frames-segment .frames-segment__placeholder) {
  --at-apply: flex items-center justify-center w-full h-full text-[12px] rounded-4px whitespace-nowrap;
  color: rgba(15, 23, 42, 0.75);
  background: rgba(0, 0, 0, 0.05);
}

:where(.frames-segment .frames-segment__badge) {
  --at-apply: absolute top-1.5 left-2 px-1.5 py-0.5 text-[11px] rounded-4px pointer-events-none;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  transform-origin: left top;
  transform: scale(0.9);
}
</style>
