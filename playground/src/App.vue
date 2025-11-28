<script setup lang="ts">
import type { Renderer } from '@video-editor/renderer'
import type { ITrack, IVideoProtocol } from '@video-editor/shared'
import type { Ref } from 'vue'
import { createRenderer } from '@video-editor/renderer'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, unref, watch } from 'vue'

const swatches = {
  primary: 'https://dummyimage.com/1280x720/6aa7ff/ffffff.png&text=Clip+A',
  alt: 'https://dummyimage.com/1280x720/f97316/ffffff.png&text=Clip+C',
  video: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  extra: 'https://dummyimage.com/1280x720/22c55e/ffffff.png&text=Clip+D',
}

const protocol = reactive<IVideoProtocol>({
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
})

const firstFrameSegment = computed(() => {
  const framesTrack = protocol.tracks.find((track): track is ITrack<'frames'> => track.trackType === 'frames')
  return framesTrack?.children[0]
})

const firstFrameLabel = computed(() => firstFrameSegment.value?.extra?.label)

const canvasHost = ref<HTMLDivElement | null>(null)
const renderer = shallowRef<Renderer | null>(null)
const scrub = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)
const captionShifted = ref(false)

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

function onScrub(event: Event) {
  const target = event.target as HTMLInputElement
  const next = Number(target.value)
  scrub.value = next
  seekTo(next)
}

function swapMainClip() {
  const framesTrack = protocol.tracks.find(track => track.trackType === 'frames')
  if (!framesTrack)
    return
  const first = framesTrack.children[0]
  if (first && 'url' in first) {
    first.url = first.url === swatches.primary ? swatches.alt : swatches.primary
  }
}

function moveCaption() {
  const textTrack = protocol.tracks.find(track => track.trackType === 'text')
  const caption = textTrack?.children[0]
  if (!caption)
    return

  const shiftBy = 1000
  if (!captionShifted.value) {
    caption.startTime = shiftBy
    caption.endTime += shiftBy
    caption.texts[0].content = '字幕后移 1 秒'
  }
  else {
    caption.endTime -= caption.startTime
    caption.startTime = 0
    caption.texts[0].content = '字幕复位'
  }
  captionShifted.value = !captionShifted.value
}

function appendClip() {
  const framesTrack = protocol.tracks.find(track => track.trackType === 'frames')
  if (!framesTrack)
    return

  const lastEnd = framesTrack.children[framesTrack.children.length - 1]?.endTime ?? 0
  const start = lastEnd
  const end = start + 2000

  framesTrack.children.push({
    id: `clip-${Date.now()}`,
    segmentType: 'frames',
    type: 'image',
    format: 'img',
    url: swatches.extra,
    startTime: start,
    endTime: end,
    opacity: 0.95,
    extra: { aiTag: 'appended', label: 'Clip D' },
  })
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

      <div class="timeline">
        <input
          type="range"
          :value="scrub"
          min="0"
          :max="Math.max(unref(durationMs), 1)"
          step="16"
          @input="onScrub"
        >
        <div class="timeline__labels">
          <span>{{ formatMs(scrub) }}</span>
          <span>{{ formatMs(durationMs) }}</span>
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
