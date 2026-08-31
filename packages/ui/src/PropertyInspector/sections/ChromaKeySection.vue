<script setup lang="ts">
import type { IChromaKey } from '@video-editor/shared'
import type { DeepReadonly } from 'vue'
import { computed } from 'vue'
import NumberField from '../NumberField.vue'

defineOptions({ name: 'PropertyInspectorChromaKeySection' })

const props = defineProps<{
  chromaKey?: DeepReadonly<IChromaKey> | null
}>()

const emit = defineEmits<{
  (e: 'change', chromaKey: IChromaKey | undefined): void
}>()

const DEFAULT_CHROMA_KEY: IChromaKey = {
  color: '#00ff00',
  similarity: 0.35,
  smoothness: 0.1,
  spillSuppress: 0.5,
}

const enabled = computed(() => Boolean(props.chromaKey))

// Template-friendly accessors: object-type casts inside the template break dts emit.
const color = computed(() => props.chromaKey?.color ?? DEFAULT_CHROMA_KEY.color)
const similarity = computed(() => props.chromaKey?.similarity ?? DEFAULT_CHROMA_KEY.similarity)
const smoothness = computed(() => props.chromaKey?.smoothness ?? 0)
const spillSuppress = computed(() => props.chromaKey?.spillSuppress ?? 0)

function current(): IChromaKey {
  const key = props.chromaKey
  if (!key)
    return { ...DEFAULT_CHROMA_KEY }
  return {
    color: key.color,
    similarity: key.similarity,
    ...(key.smoothness === undefined ? {} : { smoothness: key.smoothness }),
    ...(key.spillSuppress === undefined ? {} : { spillSuppress: key.spillSuppress }),
  }
}

function toggle(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  emit('change', checked ? current() : undefined)
}

function setColor(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  // The schema only accepts `#rrggbb`; ignore anything else while typing.
  if (!/^#[0-9a-f]{6}$/i.test(raw))
    return
  const next = current()
  next.color = raw.toLowerCase()
  emit('change', next)
}

function setNumber(key: 'similarity' | 'smoothness' | 'spillSuppress', value: number | undefined) {
  const next = current()
  next[key] = clamp(value ?? 0, 0, 1)
  emit('change', next)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
</script>

<template>
  <div class="pi-chroma">
    <div class="pi-chroma__header">
      <span class="pi-chroma__title">抠像</span>
      <label class="pi-chroma__toggle">
        <input type="checkbox" :checked="enabled" @change="toggle">
        <span>启用</span>
      </label>
    </div>

    <template v-if="enabled">
      <label class="pi-chroma__row">
        <span class="pi-chroma__label">颜色</span>
        <input class="pi-chroma__color" type="color" :value="color" @input="setColor">
        <span class="pi-chroma__hex">{{ color }}</span>
      </label>

      <NumberField
        label="相似度" :model-value="similarity"
        :min="0" :max="1" :step="0.01" slider
        @update:model-value="value => setNumber('similarity', value)"
      />
      <NumberField
        label="边缘柔化" :model-value="smoothness"
        :min="0" :max="1" :step="0.01" slider
        @update:model-value="value => setNumber('smoothness', value)"
      />
      <NumberField
        label="溢色抑制" :model-value="spillSuppress"
        :min="0" :max="1" :step="0.01" slider
        @update:model-value="value => setNumber('spillSuppress', value)"
      />
    </template>
  </div>
</template>

<style scoped>
.pi-chroma {
  --at-apply: flex flex-col gap-1.5;
}

.pi-chroma .pi-chroma__header {
  --at-apply: flex items-center justify-between;
}

.pi-chroma .pi-chroma__title {
  --at-apply: text-[11px] font-semibold uppercase tracking-wide;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}

.pi-chroma .pi-chroma__toggle {
  --at-apply: flex items-center gap-1 text-[11px] cursor-pointer;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}

.pi-chroma .pi-chroma__row {
  --at-apply: flex items-center gap-2 text-[12px];
  color: var(--ve-content-primary, rgba(0, 0, 0, 0.9));
}

.pi-chroma .pi-chroma__label {
  --at-apply: w-16 shrink-0 whitespace-nowrap;
}

.pi-chroma .pi-chroma__color {
  --at-apply: w-10 h-6 p-0 rounded-4px cursor-pointer;
  border: 1px solid var(--ve-overlay-12, rgba(0, 0, 0, 0.12));
  background: var(--ve-surface-elevated, #fff);
}

.pi-chroma .pi-chroma__hex {
  --at-apply: text-[11px] font-mono;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}
</style>
