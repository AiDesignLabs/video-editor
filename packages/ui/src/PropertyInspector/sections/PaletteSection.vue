<script setup lang="ts">
import type { IPalette } from '@video-editor/shared'
import type { DeepReadonly } from 'vue'
import NumberField from '../NumberField.vue'

defineOptions({ name: 'PropertyInspectorPaletteSection' })

const props = defineProps<{
  palette?: DeepReadonly<IPalette> | null
}>()

const emit = defineEmits<{
  (e: 'change', palette: IPalette | undefined): void
}>()

// Schema requires all 12 fields when palette is present.
const NEUTRAL: IPalette = {
  temperature: 6500,
  hue: 0,
  saturation: 0,
  brightness: 0,
  contrast: 0,
  shine: 0,
  highlight: 0,
  shadow: 0,
  sharpness: 0,
  vignette: 0,
  fade: 0,
  grain: 0,
}

const FIELDS: Array<{ key: keyof IPalette, label: string, min: number, max: number, step: number }> = [
  { key: 'temperature', label: '色温', min: 1000, max: 40000, step: 100 },
  { key: 'hue', label: '色调', min: -1, max: 1, step: 0.01 },
  { key: 'saturation', label: '饱和度', min: -1, max: 1, step: 0.01 },
  { key: 'brightness', label: '亮度', min: -1, max: 1, step: 0.01 },
  { key: 'contrast', label: '对比度', min: -1, max: 1, step: 0.01 },
  { key: 'shine', label: '光泽', min: -1, max: 1, step: 0.01 },
  { key: 'highlight', label: '高光', min: -1, max: 1, step: 0.01 },
  { key: 'shadow', label: '阴影', min: -1, max: 1, step: 0.01 },
  { key: 'sharpness', label: '锐度', min: -1, max: 1, step: 0.01 },
  { key: 'vignette', label: '暗角', min: 0, max: 1, step: 0.01 },
  { key: 'fade', label: '褪色', min: 0, max: 1, step: 0.01 },
  { key: 'grain', label: '颗粒', min: 0, max: 1, step: 0.01 },
]

function currentPalette(): IPalette {
  return { ...NEUTRAL, ...(props.palette ?? {}) }
}

function setField(key: keyof IPalette, value: number | undefined) {
  const next = currentPalette()
  next[key] = value ?? NEUTRAL[key]
  emit('change', next)
}

function reset() {
  emit('change', undefined)
}
</script>

<template>
  <div class="pi-palette">
    <div class="pi-palette__header">
      <span class="pi-palette__title">调色</span>
      <button class="pi-palette__reset" type="button" @click="reset">
        重置
      </button>
    </div>
    <NumberField
      v-for="field in FIELDS"
      :key="field.key"
      :label="field.label"
      :model-value="(props.palette ?? NEUTRAL)[field.key]"
      :min="field.min" :max="field.max" :step="field.step" slider
      @update:model-value="value => setField(field.key, value)"
    />
  </div>
</template>

<style scoped>
.pi-palette {
  --at-apply: flex flex-col gap-1.5;
}

.pi-palette .pi-palette__header {
  --at-apply: flex items-center justify-between;
}

.pi-palette .pi-palette__title {
  --at-apply: text-[11px] font-semibold uppercase tracking-wide;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}

.pi-palette .pi-palette__reset {
  --at-apply: px-2 py-0.5 rounded-4px text-[11px] cursor-pointer;
  border: 1px solid var(--ve-overlay-12, rgba(0, 0, 0, 0.12));
  background: var(--ve-surface-elevated, #fff);
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}
</style>
