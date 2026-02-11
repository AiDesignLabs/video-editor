<script setup lang="ts">
import type { IAudioSegment, IImageFramesSegment, ITextSegment, IVideoProtocol, SegmentUnion, TrackUnion } from '@video-editor/shared'
import type { Ref } from 'vue'
import { createEditorCore } from '@video-editor/editor-core'
import { generateThumbnails } from '@video-editor/protocol'
import { composeProtocol, createRenderer } from '@video-editor/renderer'
import { VideoEditorTimeline } from '@video-editor/ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, unref, watch } from 'vue'

const swatches = {
  primary: 'https://dummyimage.com/1280x720/6aa7ff/ffffff.png&text=Clip+A',
  alt: 'https://dummyimage.com/1280x720/f97316/ffffff.png&text=Clip+C',
  video: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  audio: `${window.location.origin}/test-music-3s.mp3`,
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
          fromTime: 15000,
          startTime: 3000,
          endTime: 13000,
          opacity: 1,
          volume: 5,
          extra: { aiTag: 'video-segment', confidence: 0.88, label: 'Big Buck Bunny (Sound)' },
        },
        {
          id: 'clip-c',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: swatches.alt,
          startTime: 13000,
          endTime: 16000,
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
          endTime: 16000,
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
    {
      trackId: 'audio-track',
      trackType: 'audio',
      children: [
        {
          id: 'audio-1',
          segmentType: 'audio',
          url: swatches.audio,
          startTime: 0,
          endTime: 16000,
          volume: 1,
          fadeInDuration: 100,
          fadeOutDuration: 100,
          playRate: 1,
          extra: { label: 'Audio' },
        },
      ],
    },
  ],
}

const editor = createEditorCore({ protocol: initialProtocol })
const { state, commands } = editor
const protocol = state.protocol
const scrub = state.currentTime
const selectedSegmentId = computed({
  get: () => state.selectedSegmentId.value ?? null,
  set: value => commands.setSelectedSegment(value ?? undefined),
})

const mainFramesTrack = computed(() => {
  const framesTracks = state.trackMap.value.frames ?? []
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
const composeState = reactive({
  loading: false,
  error: null as string | null,
  progress: 0,
  blobUrl: null as string | null,
  size: 0,
  durationMs: 0,
})
const loading = ref(true)
const error = ref<string | null>(null)
const captionShifted = ref(false)
const timelineZoom = ref<number | undefined>(undefined)

const protocolDuration = computed(() => {
  const endTimes = protocol.value.tracks.flatMap(track => track.children.map(seg => seg.endTime))
  return endTimes.length ? Math.max(...endTimes) : 0
})

const durationMs = computed(() => renderer.value?.duration.value ?? protocolDuration.value)
const currentTimeMs = computed(() => renderer.value?.currentTime.value ?? scrub.value)
const isPlaying = computed(() => renderer.value?.isPlaying.value ?? false)
const clipCount = computed(() => protocol.value.tracks.reduce((acc, track) => acc + track.children.length, 0))
const protocolPreview = computed(() => {
  return JSON.stringify({
    tracks: protocol.value.tracks.map(track => ({
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

const composeSourcePreview = computed(() => {
  const summary = protocol.value.tracks
    .map(track => `${track.trackType}:${track.children.length}`)
    .join(' | ')
  return summary || '无片段'
})

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  try {
    const host = canvasHost.value
    const instance = await createRenderer({
      protocol,
      autoPlay: false,
      videoSourceMode: 'auto',
      appOptions: {
        resizeTo: host ?? window,
        background: '#0f172a',
      },
    })
    renderer.value = instance
    scrub.value = instance.currentTime.value

    if (host)
      host.replaceChildren(instance.app.canvas)
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
  finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  renderer.value?.destroy()
  clearThumbnails()
  clearComposeOutput()
})

watch(renderer, (instance, _, onCleanup) => {
  if (!instance)
    return

    const stop = watch(
      () => instance.currentTime.value,
      (val) => {
        commands.setCurrentTime(val)
      },
      { immediate: true },
    )

  onCleanup(() => stop())
})

watch(durationMs, (val) => {
  if (scrub.value > val)
    commands.setCurrentTime(val)
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

function removeSelectedSegment() {
  const id = selectedSegmentId.value
  if (!id)
    return

  const result = commands.removeSegment(id)
  if (result.success)
    commands.setSelectedSegment(undefined)
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing)
    return

  const target = event.target as HTMLElement | null
  const tagName = target?.tagName
  const isEditable = target?.isContentEditable
    || tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'

  if (isEditable)
    return

  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedSegmentId.value) {
    event.preventDefault()
    removeSelectedSegment()
  }
}

function seekTo(time: number | Ref<number>) {
  const next = unref(time)
  renderer.value?.seek(next)
  commands.setCurrentTime(next)
}

function handleTimelineCurrentTime(next: number) {
  seekTo(next)
}

function handleTimelineSegmentClick(payload: { segment: SegmentUnion }) {
  commands.setSelectedSegment(payload.segment.id)
}

function handleSegmentDragEnd(payload: any) {
  commands.moveSegment({
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
  commands.resizeSegment({
    segmentId: payload.segment.id,
    trackId: payload.track.id,
    startTime: payload.startTime,
    endTime: payload.endTime,
  })
}

function handleVideoSegmentMuteToggle(payload: { segment: SegmentUnion, muted: boolean }) {
  const segment = payload.segment
  if (segment.segmentType !== 'frames' || segment.type !== 'video')
    return
  commands.updateSegment((draft) => {
    if (draft.type === 'video')
      draft.volume = payload.muted ? 0 : 1
  }, segment.id, 'frames')
}

function swapMainClip() {
  const segmentId = firstFrameSegment.value?.id
  if (!segmentId)
    return

  commands.updateSegment((segment) => {
    segment.url = segment.url === swatches.primary ? swatches.alt : swatches.primary
  }, segmentId, 'frames')
}

function moveCaption() {
  const captionId = state.trackMap.value.text?.[0]?.children[0]?.id
  if (!captionId)
    return

  const shiftBy = 1000
  commands.updateSegment((segment) => {
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
  const duration = 5000
  const seg: IImageFramesSegment = {
    id: `clip-${Date.now()}`,
    segmentType: 'frames',
    type: 'image',
    format: 'img',
    url: swatches.extra,
    startTime: currentTimeMs.value,
    endTime: currentTimeMs.value + duration,
    opacity: 0.95,
    extra: { aiTag: 'appended', label: 'Clip D' },
  }
  commands.addSegment(seg)
}

function clearThumbnails() {
  // Release object URLs before replacing them to avoid leaking memory in the demo.
  thumbnailsState.items.forEach(thumb => URL.revokeObjectURL(thumb.url))
  thumbnailsState.items = []
}

function clearComposeOutput() {
  if (composeState.blobUrl) {
    URL.revokeObjectURL(composeState.blobUrl)
  }
  composeState.blobUrl = null
  composeState.size = 0
  composeState.durationMs = 0
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

async function runComposeDemo() {
  composeState.error = null
  composeState.loading = true
  composeState.progress = 0
  clearComposeOutput()

  try {
    const { stream, durationMs } = await composeProtocol(protocol.value, {
      onProgress: (progress) => {
        composeState.progress = progress
      },
    })
    const blob = await new Response(stream).blob()
    composeState.blobUrl = URL.createObjectURL(blob)
    composeState.size = blob.size
    composeState.durationMs = durationMs
  }
  catch (err) {
    composeState.error = err instanceof Error ? err.message : String(err)
  }
  finally {
    composeState.loading = false
  }
}

const formatMs = (val: number | Ref<number>) => `${(unref(val) / 1000).toFixed(2)}s`

function handleAddSegmentClick(data: {
  track: TrackUnion
  startTime: number
  endTime?: number
  event?: MouseEvent
}) {
  const { track, startTime, endTime } = data
  const duration = endTime ? endTime - startTime : 2000 // Default duration 2s

  commands.setCurrentTime(startTime)

  switch (track.trackType) {
    case 'frames': {
      const newSegment: Omit<IImageFramesSegment, 'id'> = {
        segmentType: 'frames',
        type: 'image',
        format: 'img',
        url: swatches.extra,
        startTime: 0,
        endTime: duration,
        opacity: 1,
        extra: { label: 'New Clip' },
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    case 'text': {
      const newSegment: Omit<ITextSegment, 'id'> = {
        segmentType: 'text',
        startTime: 0,
        endTime: duration,
        texts: [{ content: 'New Text', fontSize: 24, fill: '#ffffff' }],
        extra: null,
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    case 'audio': {
      const newSegment: Omit<IAudioSegment, 'id'> = {
        segmentType: 'audio',
        url: swatches.audio,
        startTime: 0,
        endTime: duration,
        volume: 1,
      }
      commands.addSegment(newSegment, track.trackId)
      break
    }
    default:
      console.warn(`Adding segments to track type "${track.trackType}" is not implemented.`)
      return
  }
}
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
          :track-types="['frames', 'text', 'audio']"
          @update:current-time="handleTimelineCurrentTime"
          @segment-click="handleTimelineSegmentClick"
          @segment-drag-end="handleSegmentDragEnd"
          @segment-resize-end="handleSegmentResizeEnd"
          @video-segment-mute-toggle="handleVideoSegmentMuteToggle"
          @add-segment="handleAddSegmentClick"
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
        <button class="btn ghost" :disabled="!selectedSegmentId" @click="removeSelectedSegment">
          删除选中片段
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

      <div class="thumbnails compose">
        <div class="protocol__header">
          <span>composeProtocol 示例</span>
          <span class="muted">基于当前协议合成</span>
        </div>
        <p class="muted">
          轨道统计：<span class="mono">{{ composeSourcePreview }}</span>
        </p>
        <div class="thumb-actions">
          <button class="btn" :disabled="composeState.loading" @click="runComposeDemo">
            {{ composeState.loading ? '合成中…' : '合成视频' }}
          </button>
          <span v-if="composeState.error" class="error-text">失败: {{ composeState.error }}</span>
          <span v-else class="muted">进度: {{ Math.round(composeState.progress * 100) }}%</span>
        </div>
        <progress v-if="composeState.loading || composeState.progress" :value="composeState.progress" max="1" />
        <div v-if="composeState.blobUrl" class="compose-output">
          <video class="compose-video" controls :src="composeState.blobUrl" />
          <div class="muted">
            时长 {{ formatMs(composeState.durationMs) }} · 大小 {{ (composeState.size / 1024 / 1024).toFixed(2) }} MB
          </div>
          <a class="btn ghost" :href="composeState.blobUrl" download="compose-demo.mp4">下载文件</a>
        </div>
        <p v-else class="muted">
          点击按钮触发 composeProtocol，完成后可直接预览和下载合成视频。
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
