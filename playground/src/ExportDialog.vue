<script setup lang="ts">
import type { ExportFormat, ExportSettings } from './export-options'
import { computed, reactive, watch } from 'vue'
import { CODECS_BY_FORMAT, DEFAULT_CODEC } from './export-options'

defineOptions({ name: 'ExportDialog' })

const props = defineProps<{
  open: boolean
  /** Protocol canvas size / frame rate, used to seed the form. */
  sourceWidth: number
  sourceHeight: number
  sourceFps: number
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'confirm', settings: ExportSettings): void
}>()

type ResolutionPreset = '0.5' | '1' | '2' | 'custom'

const form = reactive({
  preset: '1' as ResolutionPreset,
  customWidth: props.sourceWidth,
  customHeight: props.sourceHeight,
  fps: props.sourceFps,
  format: 'mp4' as ExportFormat,
  videoCodec: DEFAULT_CODEC.mp4,
  /** Empty string means "auto" (encoder quality preset). */
  videoBitrateMbps: '' as number | '',
  audioBitrateKbps: 128,
  includeAudio: true,
})

// Even dimensions keep every codec happy, so scaled presets round to a pair.
function toEven(value: number) {
  return Math.max(2, Math.round(value / 2) * 2)
}

const resolution = computed(() => {
  if (form.preset === 'custom') {
    return {
      width: toEven(form.customWidth || props.sourceWidth),
      height: toEven(form.customHeight || props.sourceHeight),
    }
  }
  const scale = Number(form.preset)
  return {
    width: toEven(props.sourceWidth * scale),
    height: toEven(props.sourceHeight * scale),
  }
})

const codecOptions = computed(() => CODECS_BY_FORMAT[form.format])

watch(() => form.format, (format) => {
  // Codec lists differ per container; fall back to the container default.
  if (!CODECS_BY_FORMAT[format].includes(form.videoCodec))
    form.videoCodec = DEFAULT_CODEC[format]
})

watch(() => props.open, (open) => {
  if (!open)
    return
  // Re-seed from the current protocol every time the dialog opens.
  form.preset = '1'
  form.customWidth = props.sourceWidth
  form.customHeight = props.sourceHeight
  form.fps = props.sourceFps
  form.format = 'mp4'
  form.videoCodec = DEFAULT_CODEC.mp4
  form.videoBitrateMbps = ''
  form.audioBitrateKbps = 128
  form.includeAudio = true
})

function confirm() {
  const bitrate = form.videoBitrateMbps
  const settings: ExportSettings = {
    width: resolution.value.width,
    height: resolution.value.height,
    fps: Math.max(1, Math.round(form.fps) || props.sourceFps),
    format: form.format,
    videoCodec: form.videoCodec,
    videoBitrateMbps: typeof bitrate === 'number' && bitrate > 0 ? bitrate : null,
    audioBitrateKbps: Math.max(1, Math.round(form.audioBitrateKbps) || 128),
    includeAudio: form.includeAudio,
  }
  emit('confirm', settings)
}
</script>

<template>
  <div v-if="open" class="transition-modal" @click.self="emit('close')">
    <div class="transition-card export-card">
      <header class="transition-card__head">
        <strong>导出设置</strong>
        <span class="mono">{{ resolution.width }}×{{ resolution.height }}</span>
      </header>

      <label class="transition-card__field">
        <span>分辨率</span>
        <select v-model="form.preset">
          <option value="0.5">0.5×</option>
          <option value="1">1×（默认）</option>
          <option value="2">2×</option>
          <option value="custom">自定义</option>
        </select>
      </label>

      <div v-if="form.preset === 'custom'" class="export-card__pair">
        <label class="transition-card__field">
          <span>宽</span>
          <input v-model.number="form.customWidth" type="number" min="2" step="2">
        </label>
        <label class="transition-card__field">
          <span>高</span>
          <input v-model.number="form.customHeight" type="number" min="2" step="2">
        </label>
      </div>

      <label class="transition-card__field">
        <span>帧率</span>
        <input v-model.number="form.fps" type="number" min="1" max="120" step="1">
      </label>

      <label class="transition-card__field">
        <span>格式</span>
        <select v-model="form.format">
          <option value="mp4">MP4</option>
          <option value="webm">WebM</option>
        </select>
      </label>

      <label class="transition-card__field">
        <span>编码</span>
        <select v-model="form.videoCodec">
          <option v-for="codec in codecOptions" :key="codec" :value="codec">
            {{ codec.toUpperCase() }}
          </option>
        </select>
      </label>

      <label class="transition-card__field">
        <span>视频码率 (Mbps)</span>
        <input v-model.number="form.videoBitrateMbps" type="number" min="0" step="0.5" placeholder="自动">
      </label>

      <label class="transition-card__field">
        <span>包含音频</span>
        <input v-model="form.includeAudio" type="checkbox" class="export-card__check">
      </label>

      <label class="transition-card__field">
        <span>音频码率 (kbps)</span>
        <input v-model.number="form.audioBitrateKbps" type="number" min="8" step="8" :disabled="!form.includeAudio">
      </label>

      <footer class="transition-card__foot">
        <span class="transition-card__spacer" />
        <button class="tool" @click="emit('close')">
          取消
        </button>
        <button class="export" @click="confirm">
          开始导出
        </button>
      </footer>
    </div>
  </div>
</template>
