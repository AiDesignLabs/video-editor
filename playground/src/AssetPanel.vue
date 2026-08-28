<script setup lang="ts">
import type { AssetMeta } from '@video-editor/protocol'
import { createAssetLibrary, generateThumbnails } from '@video-editor/protocol'
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

defineOptions({ name: 'AssetPanel' })

const emit = defineEmits<{
  (event: 'add', asset: AssetMeta): void
}>()

const library = createAssetLibrary()

const assets = ref<AssetMeta[]>([])
const importing = ref(false)
const error = ref<string | null>(null)
const dragActive = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/** Preview object urls keyed by asset id; every entry must be revoked before it is dropped. */
const previews = reactive<Record<string, string>>({})

const KIND_GLYPH: Record<AssetMeta['kind'], string> = {
  video: '🎬',
  audio: '🎵',
  image: '🖼',
}

const KIND_LABEL: Record<AssetMeta['kind'], string> = {
  video: '视频',
  audio: '音频',
  image: '图片',
}

function revokePreviews() {
  Object.keys(previews).forEach((id) => {
    URL.revokeObjectURL(previews[id])
    delete previews[id]
  })
}

function formatBytes(size: number) {
  if (size <= 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)))
  return `${(size / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`
}

function formatDuration(ms: number | undefined) {
  if (!ms || ms <= 0)
    return null
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`
}

function describe(asset: AssetMeta) {
  const duration = formatDuration(asset.durationMs)
  return duration ? `${duration} · ${formatBytes(asset.sizeBytes)}` : formatBytes(asset.sizeBytes)
}

/** Build a preview object url for one asset; failures simply fall back to the kind glyph. */
async function loadPreview(asset: AssetMeta) {
  if (previews[asset.id])
    return

  try {
    if (asset.kind === 'image') {
      const file = await library.getAssetFile(asset.id)
      if (!file)
        return
      previews[asset.id] = URL.createObjectURL(file)
      return
    }

    if (asset.kind === 'video') {
      // Microsecond units: grab a single frame near the start of the clip.
      const shots = await generateThumbnails(asset.url, {
        imgWidth: 160,
        start: 0,
        end: 800_000,
        step: 800_000,
      })
      const first = shots[0]
      if (first)
        previews[asset.id] = URL.createObjectURL(first.img)
    }
  }
  catch {
    // Previews are best effort; the card renders the kind glyph instead.
  }
}

async function refresh() {
  revokePreviews()
  assets.value = await library.listAssets()
  await Promise.all(assets.value.map(loadPreview))
}

async function importFiles(files: File[]) {
  if (!files.length)
    return

  importing.value = true
  error.value = null
  const failures: string[] = []

  for (const file of files) {
    try {
      await library.importAsset(file)
    }
    catch (err) {
      // A single bad file must not abort the rest of the batch.
      failures.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  try {
    await refresh()
  }
  catch (err) {
    failures.push(err instanceof Error ? err.message : String(err))
  }

  error.value = failures.length ? failures.join('；') : null
  importing.value = false
}

function openPicker() {
  fileInput.value?.click()
}

async function handleInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await importFiles(files)
}

function handleDragOver(event: DragEvent) {
  if (!event.dataTransfer)
    return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  dragActive.value = true
}

function handleDragLeave() {
  dragActive.value = false
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  dragActive.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  await importFiles(files)
}

async function handleRemove(asset: AssetMeta) {
  error.value = null
  try {
    await library.removeAsset(asset.id)
    await refresh()
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => {
  refresh().catch((err) => {
    error.value = err instanceof Error ? err.message : String(err)
  })
})

onBeforeUnmount(revokePreviews)
</script>

<template>
  <div
    class="asset-panel"
    :class="{ 'asset-panel--drag': dragActive }"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div class="asset-panel__import">
      <button class="tool" :disabled="importing" @click="openPicker">
        {{ importing ? '导入中…' : '导入素材' }}
      </button>
      <p class="asset-panel__hint">
        支持视频 / 音频 / 图片，也可以直接把文件拖进本面板。素材存放在浏览器 OPFS 中。
      </p>
      <p v-if="error" class="asset-panel__error">
        {{ error }}
      </p>
      <input
        ref="fileInput"
        class="asset-panel__file"
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        @change="handleInputChange"
      >
    </div>

    <div class="asset-panel__list">
      <div v-if="assets.length" class="asset-grid">
        <article
          v-for="asset in assets"
          :key="asset.id"
          class="asset-card"
          :title="asset.name"
          @click="emit('add', asset)"
        >
          <div class="asset-card__thumb">
            <img v-if="previews[asset.id]" :src="previews[asset.id]" :alt="asset.name">
            <span v-else class="asset-card__glyph">{{ KIND_GLYPH[asset.kind] }}</span>
            <span class="asset-card__kind">{{ KIND_LABEL[asset.kind] }}</span>
          </div>
          <p class="asset-card__name">
            {{ asset.name }}
          </p>
          <p class="asset-card__meta mono">
            {{ describe(asset) }}
          </p>
          <button class="asset-card__remove" title="删除素材" @click.stop="handleRemove(asset)">
            ✕
          </button>
        </article>
      </div>
      <p v-else class="asset-panel__empty">
        还没有素材。点击「导入素材」或把文件拖进来，导入后单击卡片即可在播放头处添加片段。
      </p>
    </div>
  </div>
</template>

<style scoped>
.asset-panel {
  display: flex;
  gap: 16px;
  align-items: stretch;
  min-height: 0;
  border-radius: 10px;
  transition: outline-color 0.15s ease;
  outline: 1px dashed transparent;
  outline-offset: 4px;
}

.asset-panel--drag {
  outline-color: var(--accent);
}

.asset-panel__import {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 200px;
  padding-right: 16px;
  border-right: 1px solid var(--line);
}

.asset-panel__hint,
.asset-panel__empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.asset-panel__error {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #ff7a7a;
  word-break: break-all;
}

.asset-panel__file {
  display: none;
}

.asset-panel__list {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.asset-card {
  position: relative;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.asset-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.asset-card__thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 6px;
  background: var(--shell-deep);
}

.asset-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-card__glyph {
  font-size: 24px;
}

.asset-card__kind {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  color: var(--ink);
  background: rgba(0, 0, 0, 0.55);
}

.asset-card__name {
  margin: 6px 0 2px;
  overflow: hidden;
  font-size: 12px;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-card__meta {
  margin: 0;
  font-size: 11px;
  color: var(--ink-muted);
}

.asset-card__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  font-size: 11px;
  line-height: 20px;
  color: var(--ink);
  background: rgba(0, 0, 0, 0.6);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.asset-card:hover .asset-card__remove {
  opacity: 1;
}

.asset-card__remove:hover {
  background: #d24b4b;
}
</style>
