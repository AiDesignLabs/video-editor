<script setup lang="ts">
import type { IChromaKey, IFillMode, IKeyframeProperty, IMask, IPalette, ITextBasic, ITransform, SegmentUnion } from '@video-editor/shared'
import type { DeepReadonly } from 'vue'
import type { SegmentUpdater } from './types'
import { computed } from 'vue'
import NumberField from './NumberField.vue'
import ChromaKeySection from './sections/ChromaKeySection.vue'
import MaskSection from './sections/MaskSection.vue'
import PaletteSection from './sections/PaletteSection.vue'
import TextSection from './sections/TextSection.vue'
import TransformSection from './sections/TransformSection.vue'

defineOptions({ name: 'PropertyInspector' })

const props = defineProps<{
  segment: DeepReadonly<SegmentUnion> | null
  videoBasicInfo?: { width: number, height: number, fps: number }
  /** Playhead position; enables the add-keyframe row when inside the segment. */
  currentTimeMs?: number
}>()

const emit = defineEmits<{
  (e: 'update:segment', updater: SegmentUpdater): void
}>()

const segment = computed(() => props.segment)

const hasTransform = computed(() => {
  const type = segment.value?.segmentType
  return type === 'frames' || type === 'text' || type === 'sticker'
})

const hasOpacity = computed(() => {
  const type = segment.value?.segmentType
  return type === 'frames' || type === 'text'
})

const hasPalette = computed(() => {
  const type = segment.value?.segmentType
  return type === 'frames' || type === 'sticker'
})

// Mask and chroma key live on frames and sticker segments only.
const hasMasking = computed(() => {
  const type = segment.value?.segmentType
  return type === 'frames' || type === 'sticker'
})

const isVideo = computed(() => segment.value?.segmentType === 'frames'
  && (segment.value as DeepReadonly<SegmentUnion> & { type?: string }).type === 'video')

// Template-friendly accessors (object-type casts inside templates break dts emit).
const opacityValue = computed(() => (segment.value as { opacity?: number } | null)?.opacity ?? 1)
const volumeValue = computed(() => (segment.value as { volume?: number } | null)?.volume ?? 1)
const playRateValue = computed(() => (segment.value as { playRate?: number } | null)?.playRate ?? 1)
const reversedValue = computed(() => (segment.value as { reversed?: boolean } | null)?.reversed === true)
const fillModeValue = computed(() => (segment.value as { fillMode?: IFillMode } | null)?.fillMode ?? 'contain')
const transformValue = computed(() => (segment.value as { transform?: DeepReadonly<ITransform> } | null)?.transform)
const paletteValue = computed(() => (segment.value as { palette?: DeepReadonly<IPalette> } | null)?.palette)
const maskValue = computed(() => (segment.value as { mask?: DeepReadonly<IMask> } | null)?.mask)
const chromaKeyValue = computed(() => (segment.value as { chromaKey?: DeepReadonly<IChromaKey> } | null)?.chromaKey)

function formatMs(value: number) {
  return `${(value / 1000).toFixed(2)}s`
}

function update(updater: SegmentUpdater) {
  emit('update:segment', updater)
}

function setOpacity(value: number | undefined) {
  update((draft) => {
    if (draft.segmentType === 'frames' || draft.segmentType === 'text')
      draft.opacity = value === undefined ? undefined : Math.max(0, Math.min(1, value))
  })
}

function setTransform(transform: ITransform) {
  update((draft) => {
    if (draft.segmentType === 'frames' || draft.segmentType === 'text' || draft.segmentType === 'sticker')
      draft.transform = transform
  })
}

function setVolume(value: number | undefined) {
  update((draft) => {
    if (draft.segmentType === 'audio' || (draft.segmentType === 'frames' && draft.type === 'video'))
      draft.volume = value === undefined ? undefined : Math.max(0, Math.min(1, value))
  })
}

function setPlayRate(value: number | undefined) {
  update((draft) => {
    if (draft.segmentType === 'audio' || (draft.segmentType === 'frames' && draft.type === 'video'))
      draft.playRate = value === undefined ? undefined : Math.max(0.1, Math.min(100, value))
  })
}

function setReversed(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  update((draft) => {
    if (draft.segmentType === 'audio' || (draft.segmentType === 'frames' && draft.type === 'video'))
      draft.reversed = checked ? true : undefined
  })
}

function setFillMode(event: Event) {
  const value = (event.target as HTMLSelectElement).value as IFillMode
  update((draft) => {
    if (draft.segmentType === 'frames' || draft.segmentType === 'sticker')
      draft.fillMode = value
  })
}

function setFade(key: 'fadeInDuration' | 'fadeOutDuration', value: number | undefined) {
  update((draft) => {
    if (draft.segmentType === 'audio')
      draft[key] = value === undefined ? undefined : Math.max(0, value)
  })
}

function setIntensity(value: number | undefined) {
  update((draft) => {
    if (draft.segmentType === 'filter')
      draft.intensity = value === undefined ? undefined : Math.max(0, Math.min(1, value))
  })
}

function setPalette(palette: IPalette | undefined) {
  update((draft) => {
    if (draft.segmentType === 'frames' || draft.segmentType === 'sticker') {
      if (palette)
        draft.palette = palette
      else
        delete draft.palette
    }
  })
}

function setMask(mask: IMask | undefined) {
  update((draft) => {
    if (draft.segmentType === 'frames' || draft.segmentType === 'sticker') {
      if (mask)
        draft.mask = mask
      else
        delete draft.mask
    }
  })
}

function setChromaKey(chromaKey: IChromaKey | undefined) {
  update((draft) => {
    if (draft.segmentType === 'frames' || draft.segmentType === 'sticker') {
      if (chromaKey)
        draft.chromaKey = chromaKey
      else
        delete draft.chromaKey
    }
  })
}

const keyframeProps = computed<Array<{ property: IKeyframeProperty, label: string }>>(() => {
  const seg = segment.value
  if (!seg)
    return []
  const list: Array<{ property: IKeyframeProperty, label: string }> = []
  if (seg.segmentType === 'frames' || seg.segmentType === 'text') {
    list.push({ property: 'opacity', label: '不透明度' })
  }
  if (seg.segmentType === 'frames' || seg.segmentType === 'text' || seg.segmentType === 'sticker') {
    list.push(
      { property: 'position.x', label: 'X' },
      { property: 'position.y', label: 'Y' },
      { property: 'scale', label: '缩放' },
      { property: 'rotation', label: '旋转' },
    )
  }
  if (seg.segmentType === 'audio' || (seg.segmentType === 'frames' && (seg as { type?: string }).type === 'video'))
    list.push({ property: 'volume', label: '音量' })
  if (seg.segmentType === 'filter')
    list.push({ property: 'intensity', label: '强度' })
  return list
})

const playheadInSegment = computed(() => {
  const seg = segment.value
  if (!seg || props.currentTimeMs === undefined)
    return false
  return props.currentTimeMs >= seg.startTime && props.currentTimeMs <= seg.endTime
})

function readCurrentPropertyValue(seg: DeepReadonly<SegmentUnion>, property: IKeyframeProperty): number {
  const transform = (seg as { transform?: DeepReadonly<ITransform> }).transform
  switch (property) {
    case 'opacity': return (seg as { opacity?: number }).opacity ?? 1
    case 'volume': return (seg as { volume?: number }).volume ?? 1
    case 'intensity': return (seg as { intensity?: number }).intensity ?? 1
    case 'position.x': return transform?.position[0] ?? 0
    case 'position.y': return transform?.position[1] ?? 0
    case 'scale': return transform?.scale[0] ?? 1
    case 'rotation': return transform?.rotation[2] ?? 0
  }
}

function addKeyframeAtPlayhead(property: IKeyframeProperty) {
  const seg = segment.value
  if (!seg || props.currentTimeMs === undefined)
    return
  const value = readCurrentPropertyValue(seg, property)
  const timeMs = Math.max(0, Math.round(props.currentTimeMs - seg.startTime))
  update((draft) => {
    const tracks = draft.keyframes ?? (draft.keyframes = [])
    let track = tracks.find(item => item.property === property)
    if (!track) {
      track = { property, frames: [] }
      tracks.push(track)
    }
    const existing = track.frames.find(frame => frame.timeMs === timeMs)
    if (existing)
      existing.value = value
    else
      track.frames.push({ timeMs, value })
    track.frames.sort((a, b) => a.timeMs - b.timeMs)
  })
}

function clearKeyframes() {
  update((draft) => {
    delete draft.keyframes
  })
}

function changeTextLine(index: number, patch: Partial<ITextBasic>) {
  update((draft) => {
    if (draft.segmentType !== 'text')
      return
    const line = draft.texts[index]
    if (!line)
      return
    Object.assign(line, patch)
    for (const key of Object.keys(patch) as Array<keyof ITextBasic>) {
      if (patch[key] === undefined)
        delete line[key]
    }
  })
}

function addTextLine() {
  update((draft) => {
    if (draft.segmentType === 'text')
      draft.texts.push({ content: '新文本' })
  })
}

function removeTextLine(index: number) {
  update((draft) => {
    if (draft.segmentType === 'text' && draft.texts.length > 1)
      draft.texts.splice(index, 1)
  })
}
</script>

<template>
  <aside class="property-inspector">
    <div v-if="!segment" class="property-inspector__empty">
      选择一个片段以编辑属性
    </div>

    <template v-else>
      <div class="property-inspector__header">
        <span class="property-inspector__type">{{ segment.segmentType }}</span>
        <span class="property-inspector__time">
          {{ formatMs(segment.startTime) }} → {{ formatMs(segment.endTime) }}
        </span>
      </div>

      <div class="property-inspector__section">
        <NumberField
          v-if="hasOpacity"
          label="不透明度"
          :model-value="opacityValue"
          :min="0" :max="1" :step="0.01" slider
          @update:model-value="setOpacity"
        />

        <template v-if="isVideo || segment.segmentType === 'audio'">
          <NumberField
            label="音量"
            :model-value="volumeValue"
            :min="0" :max="1" :step="0.01" slider
            @update:model-value="setVolume"
          />
          <NumberField
            label="倍速"
            :model-value="playRateValue"
            :min="0.1" :max="4" :step="0.1" slider
            @update:model-value="setPlayRate"
          />
          <label class="property-inspector__row">
            <span class="property-inspector__label">倒放</span>
            <input
              class="property-inspector__checkbox"
              type="checkbox"
              :checked="reversedValue"
              @change="setReversed"
            >
          </label>
        </template>

        <label v-if="segment.segmentType === 'frames' || segment.segmentType === 'sticker'" class="property-inspector__row">
          <span class="property-inspector__label">填充</span>
          <select
            class="property-inspector__select"
            :value="fillModeValue"
            @change="setFillMode"
          >
            <option value="contain">contain</option>
            <option value="cover">cover</option>
            <option value="stretch">stretch</option>
            <option value="none">none</option>
          </select>
        </label>

        <template v-if="segment.segmentType === 'audio'">
          <NumberField
            label="淡入 (ms)"
            :model-value="segment.fadeInDuration"
            :min="0" :max="10000" :step="50"
            @update:model-value="value => setFade('fadeInDuration', value)"
          />
          <NumberField
            label="淡出 (ms)"
            :model-value="segment.fadeOutDuration"
            :min="0" :max="10000" :step="50"
            @update:model-value="value => setFade('fadeOutDuration', value)"
          />
        </template>

        <NumberField
          v-if="segment.segmentType === 'filter'"
          label="强度"
          :model-value="segment.intensity ?? 1"
          :min="0" :max="1" :step="0.01" slider
          @update:model-value="setIntensity"
        />

        <div v-if="segment.segmentType === 'effect'" class="property-inspector__row">
          <span class="property-inspector__label">特效</span>
          <span>{{ segment.name }}</span>
        </div>
      </div>

      <TextSection
        v-if="segment.segmentType === 'text'"
        class="property-inspector__section"
        :texts="segment.texts"
        @change-line="changeTextLine"
        @add-line="addTextLine"
        @remove-line="removeTextLine"
      />

      <TransformSection
        v-if="hasTransform"
        class="property-inspector__section"
        :transform="transformValue"
        @change="setTransform"
      />

      <PaletteSection
        v-if="hasPalette"
        class="property-inspector__section"
        :palette="paletteValue"
        @change="setPalette"
      />

      <ChromaKeySection
        v-if="hasMasking"
        class="property-inspector__section"
        :chroma-key="chromaKeyValue"
        @change="setChromaKey"
      />

      <MaskSection
        v-if="hasMasking"
        class="property-inspector__section"
        :mask="maskValue"
        @change="setMask"
      />

      <div v-if="keyframeProps.length && props.currentTimeMs !== undefined" class="property-inspector__section">
        <div class="property-inspector__row property-inspector__keyframes-header">
          <span class="property-inspector__label">关键帧</span>
          <span v-if="!playheadInSegment" class="property-inspector__hint">播放头不在片段内</span>
          <button
            v-if="segment.keyframes?.length"
            class="property-inspector__kf-clear"
            type="button"
            @click="clearKeyframes"
          >清空</button>
        </div>
        <div class="property-inspector__kf-buttons">
          <button
            v-for="item in keyframeProps"
            :key="item.property"
            class="property-inspector__kf-button"
            type="button"
            :disabled="!playheadInSegment"
            :title="`在播放头处为 ${item.label} 打关键帧`"
            @click="addKeyframeAtPlayhead(item.property)"
          >
            ◆ {{ item.label }}
          </button>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
:where(.property-inspector) {
  --at-apply: flex flex-col gap-3 p-3 rounded-8px w-full;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

:where(.property-inspector .property-inspector__empty) {
  --at-apply: py-6 text-center text-[12px];
  color: rgba(15, 23, 42, 0.45);
}

:where(.property-inspector .property-inspector__header) {
  --at-apply: flex items-center justify-between gap-2;
}

:where(.property-inspector .property-inspector__type) {
  --at-apply: px-2 py-1 rounded-full text-[11px] font-semibold uppercase;
  background: rgba(34, 34, 38, 0.08);
  color: #222226;
}

:where(.property-inspector .property-inspector__time) {
  --at-apply: text-[11px];
  color: rgba(15, 23, 42, 0.55);
}

:where(.property-inspector .property-inspector__section) {
  --at-apply: flex flex-col gap-1.5 pt-2;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}

:where(.property-inspector .property-inspector__row) {
  --at-apply: flex items-center gap-2 text-[12px];
  color: rgba(15, 23, 42, 0.75);
}

:where(.property-inspector .property-inspector__label) {
  --at-apply: w-16 shrink-0 whitespace-nowrap;
}

:where(.property-inspector .property-inspector__select) {
  --at-apply: px-1.5 py-1 rounded-4px text-[12px];
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
}

:where(.property-inspector .property-inspector__checkbox) {
  --at-apply: cursor-pointer;
  accent-color: #2563eb;
}

:where(.property-inspector .property-inspector__hint) {
  --at-apply: text-[11px];
  color: rgba(15, 23, 42, 0.4);
}

:where(.property-inspector .property-inspector__kf-buttons) {
  --at-apply: flex items-center gap-1.5 flex-wrap;
}

:where(.property-inspector .property-inspector__kf-button) {
  --at-apply: px-2 py-1 rounded-4px text-[11px] cursor-pointer;
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
  color: rgba(15, 23, 42, 0.7);
}

:where(.property-inspector .property-inspector__kf-button:disabled) {
  --at-apply: cursor-not-allowed;
  opacity: 0.4;
}

:where(.property-inspector .property-inspector__kf-clear) {
  --at-apply: ml-auto px-2 py-0.5 rounded-4px text-[11px] cursor-pointer;
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
  color: rgba(15, 23, 42, 0.6);
}
</style>
