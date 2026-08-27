<script setup lang="ts">
import type { IFillMode, IPalette, ITextBasic, ITransform, SegmentUnion } from '@video-editor/shared'
import type { DeepReadonly } from 'vue'
import type { SegmentUpdater } from './types'
import { computed } from 'vue'
import NumberField from './NumberField.vue'
import PaletteSection from './sections/PaletteSection.vue'
import TextSection from './sections/TextSection.vue'
import TransformSection from './sections/TransformSection.vue'

defineOptions({ name: 'PropertyInspector' })

const props = defineProps<{
  segment: DeepReadonly<SegmentUnion> | null
  videoBasicInfo?: { width: number, height: number, fps: number }
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

const isVideo = computed(() => segment.value?.segmentType === 'frames'
  && (segment.value as DeepReadonly<SegmentUnion> & { type?: string }).type === 'video')

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
          :model-value="(segment as { opacity?: number }).opacity ?? 1"
          :min="0" :max="1" :step="0.01" slider
          @update:model-value="setOpacity"
        />

        <template v-if="isVideo || segment.segmentType === 'audio'">
          <NumberField
            label="音量"
            :model-value="(segment as { volume?: number }).volume ?? 1"
            :min="0" :max="1" :step="0.01" slider
            @update:model-value="setVolume"
          />
          <NumberField
            label="倍速"
            :model-value="(segment as { playRate?: number }).playRate ?? 1"
            :min="0.1" :max="4" :step="0.1" slider
            @update:model-value="setPlayRate"
          />
        </template>

        <label v-if="segment.segmentType === 'frames' || segment.segmentType === 'sticker'" class="property-inspector__row">
          <span class="property-inspector__label">填充</span>
          <select
            class="property-inspector__select"
            :value="(segment as { fillMode?: IFillMode }).fillMode ?? 'contain'"
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
        :transform="(segment as { transform?: DeepReadonly<ITransform> }).transform"
        @change="setTransform"
      />

      <PaletteSection
        v-if="hasPalette"
        class="property-inspector__section"
        :palette="(segment as { palette?: DeepReadonly<IPalette> }).palette"
        @change="setPalette"
      />
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
</style>
