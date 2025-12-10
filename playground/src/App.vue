<script setup lang="ts">
import type { Renderer } from '@video-editor/renderer'
import type { IFramesSegmentUnion, IVideoProtocol, SegmentUnion } from '@video-editor/shared'
import type { Ref } from 'vue'
import { createVideoProtocolManager, generateThumbnails } from '@video-editor/protocol'
import { createRenderer } from '@video-editor/renderer'
import { VideoEditorTimeline } from '@video-editor/ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, unref, watch } from 'vue'

const swatches = {
  primary: 'https://dummyimage.com/1280x720/6aa7ff/ffffff.png&text=Clip+A',
  alt: 'https://dummyimage.com/1280x720/f97316/ffffff.png&text=Clip+C',
  video: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  extra: 'https://dummyimage.com/1280x720/22c55e/ffffff.png&text=Clip+D',
}

const initialProtocol: IVideoProtocol = {
  id: 'demo-protocol',
  version: '1.0.0',
  width: 1280,
  height: 720,
  fps: 30,
  extra: { projectName: 'Playground Demo' },
  tracks: [
    {
      trackId: 'frames-track',
      trackType: 'frames',
      isMain: true,
      extra: { trackOwner: 'demo-owner' },
      children: [
        {
          id: 'clip-b',
          segmentType: 'frames',
          type: 'video',
          url: swatches.video,
          fromTime: 1000,
          startTime: 3000,
          endTime: 6000,
          opacity: 1,
          extra: { aiTag: 'video-segment', confidence: 0.88, label: 'Clip B' },
        },
        {
          id: 'clip-c',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: swatches.alt,
          startTime: 6000,
          endTime: 9000,
          opacity: 1,
          extra: { aiTag: 'ending', confidence: 0.91, label: 'Clip C' },
        },
        {
          id: 'clip-a',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: swatches.primary,
          startTime: 0,
          endTime: 3000,
          opacity: 1,
          extra: { aiTag: 'warm-start', confidence: 0.96, label: 'Clip A' },
        },
      ],
    },
    {
      trackId: 'text-track',
      trackType: 'text',
      children: [
        {
          id: 'caption-1',
          segmentType: 'text',
          startTime: 0,
          endTime: 9000,
          opacity: 0.9,
          texts: [{ content: '你好，随便拖动时间轴', fontSize: 24, fill: 'rgba(248,250,252,1)' }],
          transform: {
            position: [0, 0.65, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          extra: { author: 'demo-bot' },
        },
      ],
    },
  ],
}

const { curTime, exportProtocol, trackMap, addSegment, updateSegment, moveSegment, resizeSegment } = createVideoProtocolManager(initialProtocol)
const protocolRef = computed(() => clone(exportProtocol()))
const protocol = reactive(protocolRef.value)
watch(protocolRef, next => Object.assign(protocol, clone(next)), { immediate: true })
const scrub = curTime

const mainFramesTrack = computed(() => {
  const framesTracks = trackMap.value.frames ?? []
  return framesTracks.find(track => track.isMain) ?? framesTracks[0]
})

const firstFrameSegment = computed(() => {
  return mainFramesTrack.value?.children[0]
})

const firstFrameLabel = computed(() => firstFrameSegment.value?.extra?.label)

const canvasHost = ref<HTMLDivElement | null>(null)
const renderer = shallowRef<Renderer | null>(null)
const thumbnailsState = reactive({
  items: [] as Array<{ tsMs: number, url: string }>,
  loading: false,
  error: null as string | null,
})
const loading = ref(true)
const error = ref<string | null>(null)
const captionShifted = ref(false)
const timelineZoom = ref<number | undefined>(undefined)
const selectedSegmentId = ref<string | null>(null)

const protocolDuration = computed(() => {
  const endTimes = protocol.tracks.flatMap(track => track.children.map(seg => seg.endTime))
  return endTimes.length ? Math.max(...endTimes) : 0
})

const durationMs = computed(() => renderer.value?.duration.value ?? protocolDuration.value)
const currentTimeMs = computed(() => renderer.value?.currentTime.value ?? scrub.value)
const isPlaying = computed(() => renderer.value?.isPlaying.value ?? false)
const clipCount = computed(() => protocol.tracks.reduce((acc, track) => acc + track.children.length, 0))
const protocolPreview = computed(() => {
  return JSON.stringify({
    tracks: protocol.tracks.map(track => ({
      type: track.trackType,
      children: track.children.map(child => ({
        id: child.id,
        start: child.startTime,
        end: child.endTime,
        url: 'url' in child ? child.url : undefined,
      })),
    })),
  }, null, 2)
})

const thumbnailSourceUrl = computed(() => {
  const videoSegment = mainFramesTrack.value?.children.find(segment => segment.segmentType === 'frames' && segment.type === 'video')
  return videoSegment && 'url' in videoSegment ? videoSegment.url : swatches.video
})

onMounted(async () => {
  try {
    const host = canvasHost.value
    const instance = await createRenderer({
      protocol,
      autoPlay: true,
      appOptions: {
        resizeTo: host ?? window,
        background: '#0f172a',
      },
    })
    renderer.value = instance
    scrub.value = instance.currentTime.value

    if (host)
      host.replaceChildren(instance.app.canvas)
    instance.play()
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
  finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  renderer.value?.destroy()
  clearThumbnails()
})

watch(renderer, (instance, _, onCleanup) => {
  if (!instance)
    return

  const stop = watch(
    () => instance.currentTime.value,
    (val) => {
      scrub.value = val
    },
    { immediate: true },
  )

  onCleanup(() => stop())
})

watch(durationMs, (val) => {
  if (scrub.value > val)
    scrub.value = val
})

function togglePlay() {
  const inst = renderer.value
  if (!inst)
    return
  if (inst.isPlaying.value)
    inst.pause()
  else
    inst.play()
}

function seekTo(time: number | Ref<number>) {
  const next = unref(time)
  renderer.value?.seek(next)
  scrub.value = next
}

function handleTimelineCurrentTime(next: number) {
  seekTo(next)
}

function handleTimelineSegmentClick(payload: { segment: SegmentUnion }) {
  selectedSegmentId.value = payload.segment.id
}

function handleSegmentDragEnd(payload: any) {
  moveSegment({
    segmentId: payload.segment.id,
    sourceTrackId: payload.track.id,
    targetTrackId: payload.targetTrackId,
    startTime: payload.startTime,
    endTime: payload.endTime,
    isNewTrack: payload.isNewTrack,
    newTrackInsertIndex: payload.newTrackInsertIndex,
  })
}

function handleSegmentResizeEnd(payload: any) {
  resizeSegment({
    segmentId: payload.segment.id,
    trackId: payload.track.id,
    startTime: payload.startTime,
    endTime: payload.endTime,
  })
}

function swapMainClip() {
  const segmentId = firstFrameSegment.value?.id
  if (!segmentId)
    return

  updateSegment((segment) => {
    segment.url = segment.url === swatches.primary ? swatches.alt : swatches.primary
  }, segmentId, 'frames')
}

function moveCaption() {
  const captionId = trackMap.value.text?.[0]?.children[0]?.id
  if (!captionId)
    return

  const shiftBy = 1000
  updateSegment((segment) => {
    if (!captionShifted.value) {
      segment.startTime = shiftBy
      segment.endTime += shiftBy
      segment.texts[0].content = '字幕后移 1 秒'
    }
    else {
      segment.endTime -= segment.startTime
      segment.startTime = 0
      segment.texts[0].content = '字幕复位'
    }
  }, captionId, 'text')
  captionShifted.value = !captionShifted.value
}

function appendClip() {
  const lastEnd = mainFramesTrack.value?.children.at(-1)?.endTime ?? 0
  const end = lastEnd + 2000
  curTime.value = lastEnd

  const seg: IFramesSegmentUnion = {
    id: `clip-${Date.now()}`,
    segmentType: 'frames',
    type: 'image',
    format: 'img',
    url: swatches.extra,
    startTime: 0,
    endTime: end - lastEnd,
    opacity: 0.95,
    extra: { aiTag: 'appended', label: 'Clip D' },
  }
  addSegment(seg)
}

function clearThumbnails() {
  // Release object URLs before replacing them to avoid leaking memory in the demo.
  thumbnailsState.items.forEach(thumb => URL.revokeObjectURL(thumb.url))
  thumbnailsState.items = []
}

async function runThumbnailDemo() {
  thumbnailsState.error = null
  thumbnailsState.loading = true
  clearThumbnails()

  try {
    const shots = await generateThumbnails(thumbnailSourceUrl.value, {
      imgWidth: 160,
      start: 0,
      end: 5_000_000,
      step: 800_000,
    })

    thumbnailsState.items = shots.map(thumb => ({
      tsMs: Math.round(thumb.ts / 1000),
      url: URL.createObjectURL(thumb.img),
    }))
  }
  catch (err) {
    thumbnailsState.error = err instanceof Error ? err.message : String(err)
  }
  finally {
    thumbnailsState.loading = false
  }
}

const formatMs = (val: number | Ref<number>) => `${(unref(val) / 1000).toFixed(2)}s`
</script>

<template>
  <main class="page">
    <section class="hero">
      <div>
        <p class="eyebrow">
          @video-editor/renderer playground
        </p>
        <h1>用协议驱动的轻量播放器</h1>
        <p class="lede">
          修改 reactive protocol 就能看到画面更新。拖动时间轴、切换片段或追加新的 clip，Pixi 场景会自动响应。
        </p>
        <div class="pill-row">
          <span class="pill">Tracks: {{ protocol.tracks.length }}</span>
          <span class="pill">Clips: {{ clipCount }}</span>
          <span class="pill">FPS: {{ protocol.fps }}</span>
          <span class="pill">Frame label: {{ firstFrameLabel }}</span>
          <span class="pill">Project: {{ protocol.extra?.projectName ?? '未命名' }}</span>
        </div>
      </div>
      <div class="stat">
        <div class="stat__label">
          当前时间
        </div>
        <div class="stat__value">
          {{ formatMs(currentTimeMs) }}
        </div>
        <div class="stat__sub">
          / {{ formatMs(durationMs) }}
        </div>
      </div>
    </section>

    <section class="player-shell">
      <div class="canvas">
        <div ref="canvasHost" class="canvas-host" />
        <div v-if="loading && !error" class="placeholder">
          正在初始化 Pixi 应用…
        </div>
        <div v-else-if="error" class="placeholder error">
          初始化失败: {{ error }}
        </div>
      </div>

      <div class="timeline min-h-400px">
        <VideoEditorTimeline
          v-model:zoom="timelineZoom"
          v-model:selected-segment-id="selectedSegmentId"
          class="flex-1"
          :protocol="protocol"
          :current-time="currentTimeMs"
          :track-types="['frames', 'text']"
          @update:current-time="handleTimelineCurrentTime"
          @segment-click="handleTimelineSegmentClick"
          @segment-drag-end="handleSegmentDragEnd"
          @segment-resize-end="handleSegmentResizeEnd"
        />
        <div class="timeline-meta">
          <div>时间轴使用 UI 包的默认 toolbar / ruler / playhead（主色 #222226）。</div>
          <div class="muted">
            点击 +/- 只会放大刻度与片段宽度，Pixi 预览画布不会缩放；需要自定义可通过 slots 覆盖。
          </div>
        </div>
      </div>

      <div class="controls">
        <button class="btn" :disabled="!renderer" @click="togglePlay">
          {{ isPlaying ? '暂停' : '播放' }}
        </button>
        <button class="btn ghost" :disabled="!renderer" @click="seekTo(0)">
          回到开头
        </button>
        <button class="btn ghost" :disabled="!renderer" @click="seekTo(durationMs)">
          跳到末尾
        </button>
      </div>
    </section>

    <section class="panel">
      <div class="actions">
        <button class="btn" @click="swapMainClip">
          切换主画面贴图
        </button>
        <button class="btn" @click="moveCaption">
          移动字幕
        </button>
        <button class="btn" @click="appendClip">
          追加新片段
        </button>
      </div>

      <div class="thumbnails">
        <div class="protocol__header">
          <span>generateThumbnails 示例</span>
          <span class="muted">基于 frames track 的视频片段</span>
        </div>
        <p class="muted">
          源地址：<span class="mono">{{ thumbnailSourceUrl }}</span>
        </p>
        <div class="thumb-actions">
          <button class="btn" :disabled="thumbnailsState.loading" @click="runThumbnailDemo">
            {{ thumbnailsState.loading ? '生成中…' : '生成缩略图' }}
          </button>
          <span v-if="thumbnailsState.error" class="error-text">失败: {{ thumbnailsState.error }}</span>
        </div>
        <div v-if="thumbnailsState.items.length" class="thumbnail-grid">
          <div v-for="thumb in thumbnailsState.items" :key="thumb.url" class="thumbnail-card">
            <img :src="thumb.url" alt="thumbnail frame" loading="lazy">
            <span>{{ (thumb.tsMs / 1000).toFixed(2) }}s</span>
          </div>
        </div>
        <p v-else class="muted">
          点击按钮调用 generateThumbnails，查看返回的 Blob 缩略图。
        </p>
      </div>

      <div class="protocol">
        <div class="protocol__header">
          <span>协议快照</span>
          <span class="muted">实时变化会驱动画面</span>
        </div>
        <pre>{{ protocolPreview }}</pre>
      </div>
    </section>
  </main>
</template>
