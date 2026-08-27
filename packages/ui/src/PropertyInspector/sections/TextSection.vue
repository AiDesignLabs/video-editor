<script setup lang="ts">
import type { ITextBasic } from '@video-editor/shared'
import type { DeepReadonly } from 'vue'
import { computed, ref, watch } from 'vue'
import NumberField from '../NumberField.vue'

defineOptions({ name: 'PropertyInspectorTextSection' })

const props = defineProps<{
  texts: DeepReadonly<ITextBasic[]>
}>()

const emit = defineEmits<{
  (e: 'change-line', index: number, patch: Partial<ITextBasic>): void
  (e: 'add-line'): void
  (e: 'remove-line', index: number): void
}>()

const activeIndex = ref(0)

watch(() => props.texts.length, (length) => {
  if (activeIndex.value >= length)
    activeIndex.value = Math.max(0, length - 1)
})

const activeLine = computed(() => props.texts[activeIndex.value])

function patchActive(patch: Partial<ITextBasic>) {
  emit('change-line', activeIndex.value, patch)
}

function onContentInput(event: Event) {
  patchActive({ content: (event.target as HTMLInputElement).value })
}

function onColorInput(key: 'fill', event: Event) {
  patchActive({ [key]: (event.target as HTMLInputElement).value })
}

function onAlignChange(event: Event) {
  patchActive({ align: (event.target as HTMLSelectElement).value as ITextBasic['align'] })
}

function toggleBold() {
  patchActive({ fontWeight: activeLine.value?.fontWeight === 'bold' ? 'normal' : 'bold' })
}

function toggleUnderline() {
  patchActive({ underline: !activeLine.value?.underline })
}

function onStrokeColor(event: Event) {
  const color = (event.target as HTMLInputElement).value
  patchActive({ stroke: { color, width: props.texts[activeIndex.value]?.stroke?.width ?? 1 } })
}

function onStrokeWidth(value: number | undefined) {
  const line = activeLine.value
  if (value === undefined || value <= 0) {
    patchActive({ stroke: undefined })
    return
  }
  patchActive({ stroke: { color: line?.stroke?.color ?? '#000000', width: value } })
}

function onBackgroundColor(event: Event) {
  patchActive({ background: { color: (event.target as HTMLInputElement).value } })
}
</script>

<template>
  <div class="pi-text">
    <div class="pi-text__title">
      文字（每行独立样式）
    </div>

    <div class="pi-text__lines">
      <button
        v-for="(_line, index) in props.texts"
        :key="index"
        class="pi-text__line-tab"
        :class="{ 'pi-text__line-tab--active': index === activeIndex }"
        type="button"
        @click="activeIndex = index"
      >
        行 {{ index + 1 }}
      </button>
      <button class="pi-text__line-tab" type="button" @click="emit('add-line')">
        ＋
      </button>
      <button
        v-if="props.texts.length > 1"
        class="pi-text__line-tab"
        type="button"
        @click="emit('remove-line', activeIndex)"
      >
        －
      </button>
    </div>

    <template v-if="activeLine">
      <label class="pi-text__row">
        <span class="pi-text__label">内容</span>
        <input class="pi-text__input" type="text" :value="activeLine.content ?? ''" @input="onContentInput">
      </label>

      <NumberField
        label="字号" :model-value="activeLine.fontSize ?? 32"
        :min="8" :max="200" :step="1" slider
        @update:model-value="value => patchActive({ fontSize: value })"
      />

      <div class="pi-text__row">
        <span class="pi-text__label">颜色</span>
        <input class="pi-text__color" type="color" :value="activeLine.fill ?? '#ffffff'" @input="onColorInput('fill', $event)">
        <span class="pi-text__label">对齐</span>
        <select class="pi-text__select" :value="activeLine.align ?? 'left'" @change="onAlignChange">
          <option value="left">左</option>
          <option value="center">中</option>
          <option value="right">右</option>
        </select>
        <button
          class="pi-text__toggle" :class="{ 'pi-text__toggle--on': activeLine.fontWeight === 'bold' }"
          type="button" @click="toggleBold"
        >B</button>
        <button
          class="pi-text__toggle" :class="{ 'pi-text__toggle--on': activeLine.underline }"
          type="button" @click="toggleUnderline"
        >U</button>
      </div>

      <div class="pi-text__row">
        <span class="pi-text__label">描边</span>
        <input class="pi-text__color" type="color" :value="activeLine.stroke?.color ?? '#000000'" @input="onStrokeColor">
        <NumberField
          label="宽" :model-value="activeLine.stroke?.width ?? 0"
          :min="0" :max="20" :step="0.5"
          @update:model-value="onStrokeWidth"
        />
      </div>

      <div class="pi-text__row">
        <span class="pi-text__label">背景</span>
        <input class="pi-text__color" type="color" :value="activeLine.background?.color ?? '#000000'" @input="onBackgroundColor">
        <button class="pi-text__toggle" type="button" @click="patchActive({ background: undefined })">
          清除
        </button>
      </div>

      <NumberField
        label="字间距" :model-value="activeLine.letterSpacing"
        :min="-10" :max="50" :step="0.5"
        @update:model-value="value => patchActive({ letterSpacing: value })"
      />
      <NumberField
        label="行高" :model-value="activeLine.leading"
        :min="0" :max="300" :step="1"
        @update:model-value="value => patchActive({ leading: value })"
      />
    </template>
  </div>
</template>

<style scoped>
:where(.pi-text) {
  --at-apply: flex flex-col gap-1.5;
}

:where(.pi-text .pi-text__title) {
  --at-apply: text-[11px] font-semibold uppercase tracking-wide;
  color: rgba(15, 23, 42, 0.5);
}

:where(.pi-text .pi-text__lines) {
  --at-apply: flex items-center gap-1 flex-wrap;
}

:where(.pi-text .pi-text__line-tab) {
  --at-apply: px-2 py-1 rounded-4px text-[11px] cursor-pointer;
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
  color: rgba(15, 23, 42, 0.7);
}

:where(.pi-text .pi-text__line-tab--active) {
  border-color: #222226;
  color: #222226;
  font-weight: 600;
}

:where(.pi-text .pi-text__row) {
  --at-apply: flex items-center gap-2 text-[12px];
  color: rgba(15, 23, 42, 0.75);
}

:where(.pi-text .pi-text__label) {
  --at-apply: w-16 shrink-0 whitespace-nowrap;
}

:where(.pi-text .pi-text__input) {
  --at-apply: flex-1 min-w-0 px-1.5 py-1 rounded-4px text-[12px];
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
}

:where(.pi-text .pi-text__select) {
  --at-apply: px-1.5 py-1 rounded-4px text-[12px];
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
}

:where(.pi-text .pi-text__color) {
  --at-apply: w-8 h-6 p-0 rounded-4px cursor-pointer;
  border: 1px solid rgba(15, 23, 42, 0.15);
}

:where(.pi-text .pi-text__toggle) {
  --at-apply: px-2 py-1 rounded-4px text-[11px] font-semibold cursor-pointer;
  border: 1px solid rgba(15, 23, 42, 0.15);
  background: #fff;
  color: rgba(15, 23, 42, 0.6);
}

:where(.pi-text .pi-text__toggle--on) {
  border-color: #222226;
  color: #222226;
  background: rgba(34, 34, 38, 0.08);
}
</style>
