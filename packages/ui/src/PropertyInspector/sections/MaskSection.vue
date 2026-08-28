<script setup lang="ts">
import type { IMask } from '@video-editor/shared'
import type { DeepReadonly } from 'vue'
import { computed } from 'vue'
import NumberField from '../NumberField.vue'

defineOptions({ name: 'PropertyInspectorMaskSection' })

const props = defineProps<{
  mask?: DeepReadonly<IMask> | null
}>()

const emit = defineEmits<{
  (e: 'change', mask: IMask | undefined): void
}>()

const DEFAULT_MASK: IMask = {
  shape: 'rect',
  center: [0, 0],
  size: [0.5, 0.5],
}

const enabled = computed(() => Boolean(props.mask))

// Template-friendly accessors: object-type casts inside the template break dts emit.
const shape = computed(() => props.mask?.shape ?? DEFAULT_MASK.shape)
const centerX = computed(() => props.mask?.center[0] ?? 0)
const centerY = computed(() => props.mask?.center[1] ?? 0)
const sizeW = computed(() => props.mask?.size[0] ?? DEFAULT_MASK.size[0])
const sizeH = computed(() => props.mask?.size[1] ?? DEFAULT_MASK.size[1])
const feather = computed(() => props.mask?.feather ?? 0)
const rotation = computed(() => props.mask?.rotation ?? 0)
const inverse = computed(() => props.mask?.inverse ?? false)

function current(): IMask {
  const mask = props.mask
  if (!mask)
    return { ...DEFAULT_MASK, center: [...DEFAULT_MASK.center], size: [...DEFAULT_MASK.size] }
  return {
    shape: mask.shape,
    center: [mask.center[0], mask.center[1]],
    size: [mask.size[0], mask.size[1]],
    ...(mask.feather === undefined ? {} : { feather: mask.feather }),
    ...(mask.rotation === undefined ? {} : { rotation: mask.rotation }),
    ...(mask.inverse === undefined ? {} : { inverse: mask.inverse }),
  }
}

function toggle(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  emit('change', checked ? current() : undefined)
}

function setShape(event: Event) {
  const next = current()
  next.shape = (event.target as HTMLSelectElement).value === 'ellipse' ? 'ellipse' : 'rect'
  emit('change', next)
}

function setCenter(axis: 0 | 1, value: number | undefined) {
  const next = current()
  next.center[axis] = clamp(value ?? 0, -1, 1)
  emit('change', next)
}

function setSize(axis: 0 | 1, value: number | undefined) {
  const next = current()
  next.size[axis] = clamp(value ?? DEFAULT_MASK.size[axis], 0.05, 1)
  emit('change', next)
}

function setFeather(value: number | undefined) {
  const next = current()
  next.feather = clamp(value ?? 0, 0, 1)
  emit('change', next)
}

function setRotation(value: number | undefined) {
  const next = current()
  next.rotation = clamp(value ?? 0, 0, 360)
  emit('change', next)
}

function setInverse(event: Event) {
  const next = current()
  next.inverse = (event.target as HTMLInputElement).checked
  emit('change', next)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
</script>

<template>
  <div class="pi-mask">
    <div class="pi-mask__header">
      <span class="pi-mask__title">蒙版</span>
      <label class="pi-mask__toggle">
        <input type="checkbox" :checked="enabled" @change="toggle">
        <span>启用</span>
      </label>
    </div>

    <template v-if="enabled">
      <label class="pi-mask__row">
        <span class="pi-mask__label">形状</span>
        <select class="pi-mask__select" :value="shape" @change="setShape">
          <option value="rect">矩形</option>
          <option value="ellipse">椭圆</option>
        </select>
      </label>

      <NumberField
        label="中心 X" :model-value="centerX"
        :min="-1" :max="1" :step="0.01" slider
        @update:model-value="value => setCenter(0, value)"
      />
      <NumberField
        label="中心 Y" :model-value="centerY"
        :min="-1" :max="1" :step="0.01" slider
        @update:model-value="value => setCenter(1, value)"
      />
      <NumberField
        label="宽度" :model-value="sizeW"
        :min="0.05" :max="1" :step="0.01" slider
        @update:model-value="value => setSize(0, value)"
      />
      <NumberField
        label="高度" :model-value="sizeH"
        :min="0.05" :max="1" :step="0.01" slider
        @update:model-value="value => setSize(1, value)"
      />
      <NumberField
        label="羽化" :model-value="feather"
        :min="0" :max="1" :step="0.01" slider
        @update:model-value="setFeather"
      />
      <NumberField
        label="旋转" :model-value="rotation"
        :min="0" :max="360" :step="1" slider
        @update:model-value="setRotation"
      />

      <label class="pi-mask__row">
        <span class="pi-mask__label">反转</span>
        <input type="checkbox" :checked="inverse" @change="setInverse">
      </label>
    </template>
  </div>
</template>

<style scoped>
:where(.pi-mask) {
  --at-apply: flex flex-col gap-1.5;
}

:where(.pi-mask .pi-mask__header) {
  --at-apply: flex items-center justify-between;
}

:where(.pi-mask .pi-mask__title) {
  --at-apply: text-[11px] font-semibold uppercase tracking-wide;
  color: rgba(15, 23, 42, 0.5);
}

:where(.pi-mask .pi-mask__toggle) {
  --at-apply: flex items-center gap-1 text-[11px] cursor-pointer;
  color: rgba(15, 23, 42, 0.6);
}

:where(.pi-mask .pi-mask__row) {
  --at-apply: flex items-center gap-2 text-[12px];
  color: rgba(15, 23, 42, 0.75);
}

:where(.pi-mask .pi-mask__label) {
  --at-apply: w-16 shrink-0 whitespace-nowrap;
}

:where(.pi-mask .pi-mask__select) {
  --at-apply: px-1.5 py-1 rounded-4px text-[12px];
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
}
</style>
