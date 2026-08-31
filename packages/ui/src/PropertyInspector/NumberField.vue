<script setup lang="ts">
defineOptions({ name: 'PropertyInspectorNumberField' })

const props = withDefaults(defineProps<{
  label: string
  modelValue?: number
  min?: number
  max?: number
  step?: number
  slider?: boolean
  placeholder?: string
}>(), {
  step: 1,
  slider: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | undefined): void
}>()

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') {
    emit('update:modelValue', undefined)
    return
  }
  const value = Number(raw)
  if (Number.isFinite(value))
    emit('update:modelValue', value)
}
</script>

<template>
  <label class="pi-field">
    <span class="pi-field__label">{{ label }}</span>
    <input
      v-if="props.slider"
      class="pi-field__slider"
      type="range"
      :value="props.modelValue ?? props.min ?? 0"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      @input="onInput"
    >
    <input
      class="pi-field__input"
      type="number"
      :value="props.modelValue ?? ''"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :placeholder="props.placeholder"
      @input="onInput"
    >
  </label>
</template>

<style scoped>
.pi-field {
  --at-apply: flex items-center gap-2 text-[12px];
  color: var(--ve-content-primary, rgba(0, 0, 0, 0.9));
}

.pi-field .pi-field__label {
  --at-apply: w-16 shrink-0 whitespace-nowrap;
}

.pi-field .pi-field__slider {
  --at-apply: flex-1 min-w-0;
  accent-color: var(--ve-content-primary, rgba(0, 0, 0, 0.9));
}

.pi-field .pi-field__input {
  --at-apply: w-18 px-1.5 py-1 rounded-4px text-[12px];
  border: 1px solid var(--ve-overlay-12, rgba(0, 0, 0, 0.12));
  background: var(--ve-surface-elevated, #fff);
}
</style>
