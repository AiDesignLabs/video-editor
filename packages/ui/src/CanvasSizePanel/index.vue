<script setup lang="ts">
import type { CanvasSizePreset } from './presets'
import { computed, ref, watch } from 'vue'
import { CANVAS_SIZE_PRESETS, matchPreset } from './presets'

defineOptions({ name: 'CanvasSizePanel' })

const props = withDefaults(defineProps<{
  width: number
  height: number
  presets?: CanvasSizePreset[]
  /** Rejection message from the host's `setCanvasSize`, shown inline. */
  error?: string | null
  disabled?: boolean
}>(), {
  presets: () => CANVAS_SIZE_PRESETS,
  error: null,
  disabled: false,
})

const emit = defineEmits<{
  (e: 'change', size: { width: number, height: number }): void
}>()

/**
 * Draft width/height for the custom inputs.
 *
 * Kept separate from the committed size so a half-typed value (e.g. "19" on the
 * way to "1920") never reaches the protocol — the change is only emitted on
 * blur or Enter.
 */
const draftWidth = ref(String(props.width))
const draftHeight = ref(String(props.height))

watch(() => [props.width, props.height], ([width, height]) => {
  draftWidth.value = String(width)
  draftHeight.value = String(height)
})

const activePresetId = computed(() => matchPreset(props.width, props.height, props.presets)?.id ?? null)

const isDirty = computed(() => (
  draftWidth.value !== String(props.width) || draftHeight.value !== String(props.height)
))

function applyPreset(preset: CanvasSizePreset) {
  if (props.disabled)
    return
  emit('change', { width: preset.width, height: preset.height })
}

function commitDraft() {
  if (props.disabled || !isDirty.value)
    return
  // Emit whatever was typed, including nonsense — the host validates and
  // reports back through `error`, rather than this panel silently correcting it.
  emit('change', { width: Number(draftWidth.value), height: Number(draftHeight.value) })
}

function swapOrientation() {
  if (props.disabled)
    return
  emit('change', { width: props.height, height: props.width })
}
</script>

<template>
  <section class="canvas-size">
    <div class="canvas-size__presets" role="radiogroup" aria-label="画布尺寸预设">
      <button
        v-for="preset in presets"
        :key="preset.id"
        class="canvas-size__preset"
        :class="{ 'canvas-size__preset--selected': preset.id === activePresetId }"
        type="button"
        role="radio"
        :aria-checked="preset.id === activePresetId"
        :disabled="disabled"
        :title="`${preset.width} × ${preset.height}`"
        @click="applyPreset(preset)"
      >
        {{ preset.label }}
      </button>
    </div>

    <div class="canvas-size__custom">
      <label class="canvas-size__field">
        <span class="canvas-size__field-label">宽</span>
        <input
          v-model="draftWidth"
          class="canvas-size__input"
          type="number"
          inputmode="numeric"
          :disabled="disabled"
          @blur="commitDraft"
          @keyup.enter="commitDraft"
        >
      </label>

      <button
        class="ve-btn canvas-size__swap"
        type="button"
        title="交换宽高"
        aria-label="交换宽高"
        :disabled="disabled"
        @click="swapOrientation"
      >
        <span class="ve-btn__icon i-creatly-swap" aria-hidden="true" />
      </button>

      <label class="canvas-size__field">
        <span class="canvas-size__field-label">高</span>
        <input
          v-model="draftHeight"
          class="canvas-size__input"
          type="number"
          inputmode="numeric"
          :disabled="disabled"
          @blur="commitDraft"
          @keyup.enter="commitDraft"
        >
      </label>
    </div>

    <p v-if="error" class="canvas-size__error" role="alert">
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
/* Follows the spec's 节点编辑面板 rules, same as the effect designer. */
.canvas-size {
  --at-apply: flex flex-col;
  gap: var(--ve-panel-group-gap, 12px);
  padding: var(--ve-panel-padding, 16px);
  border-radius: var(--ve-panel-radius, 12px);
  background: var(--ve-panel-background, #fff);
  box-shadow: inset 0 0 0 var(--ve-stroke-width, 0.5px) var(--ve-panel-border, rgba(34, 34, 38, 0.12));
}

.canvas-size .canvas-size__presets {
  --at-apply: grid gap-0.5;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
}

.canvas-size .canvas-size__preset {
  --at-apply: cursor-pointer border-none truncate text-center;
  height: var(--ve-option-height, 32px);
  padding: 0 var(--ve-option-padding-x, 8px);
  border-radius: var(--ve-option-radius, 8px);
  font-size: 12px;
  line-height: 16px;
  color: var(--ve-content-primary, #222226);
  background: var(--ve-option-background, transparent);
  transition: background-color 150ms;
}

.canvas-size .canvas-size__preset:hover:not(:disabled) {
  background: var(--ve-option-hover-background, #f5f5f5);
}

.canvas-size .canvas-size__preset--selected {
  background: var(--ve-option-selected-background, #f0f0f0);
  box-shadow: var(--ve-option-selected-inset, inset 0 0 0 1px rgba(0, 0, 0, 0.08));
}

.canvas-size .canvas-size__preset:disabled {
  --at-apply: cursor-not-allowed;
  color: var(--ve-content-disabled, rgba(34, 34, 38, 0.35));
}

.canvas-size .canvas-size__custom {
  --at-apply: flex items-end gap-2;
}

.canvas-size .canvas-size__field {
  --at-apply: flex flex-col gap-1 min-w-0 flex-1;
}

.canvas-size .canvas-size__field-label {
  font-size: 10px;
  line-height: 16px;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}

.canvas-size .canvas-size__input {
  --at-apply: w-full min-w-0;
  height: var(--ve-option-height, 32px);
  padding: 0 var(--ve-option-padding-x, 8px);
  border: none;
  border-radius: var(--ve-option-radius, 8px);
  font-family: var(--ve-font-numeric, ui-monospace, monospace);
  font-size: 12px;
  color: var(--ve-content-primary, #222226);
  background: var(--ve-surface-control-subtle, #f5f5f5);
  box-shadow: inset 0 0 0 var(--ve-stroke-width, 0.5px) var(--ve-border-field, rgba(34, 34, 38, 0.12));
}

.canvas-size .canvas-size__swap {
  --at-apply: shrink-0;
  height: var(--ve-option-height, 32px);
  width: var(--ve-option-height, 32px);
}

.canvas-size .canvas-size__error {
  --at-apply: m-0;
  font-size: 12px;
  line-height: 20px;
  color: #ef4444;
}
</style>
