<script setup lang="ts">
import type { EffectPreset } from '../types'
import { computed } from 'vue'
import NumberField from '../NumberField.vue'

defineOptions({ name: 'PropertyInspectorEffectSection' })

const props = withDefaults(defineProps<{
  /** Which segment kind this panel is editing. */
  kind: 'filter' | 'effect'
  /** Current `filterId` / `effectId`. */
  presetId?: string
  /** Human-readable name stored on the segment. */
  name?: string
  /** Filter-only strength, 0–1. */
  intensity?: number
  /**
   * Selectable presets. `packages/ui` must not depend on the renderer, so the
   * host supplies these — the playground passes `listEffectDefinitions()`.
   */
  presets?: EffectPreset[]
}>(), {
  presetId: '',
  name: '',
  intensity: 1,
  presets: () => [],
})

const emit = defineEmits<{
  (e: 'changePreset', preset: EffectPreset): void
  (e: 'changeIntensity', intensity: number | undefined): void
}>()

const title = computed(() => (props.kind === 'filter' ? '滤镜' : '特效'))

/**
 * A segment can carry an id the host has no definition for (a preset that was
 * removed, or one produced by another editor). Surface it rather than silently
 * showing nothing selected.
 */
const unknownPreset = computed<EffectPreset | null>(() => {
  if (!props.presetId)
    return null
  if (props.presets.some(preset => preset.id === props.presetId))
    return null
  return { id: props.presetId, label: props.name || props.presetId }
})

const visiblePresets = computed(() => (
  unknownPreset.value ? [unknownPreset.value, ...props.presets] : props.presets
))

function isSelected(preset: EffectPreset) {
  return preset.id === props.presetId
}
</script>

<template>
  <section class="pi-effect">
    <header class="pi-effect__header">
      <h3 class="pi-effect__title">
        {{ title }}
      </h3>
      <span v-if="unknownPreset" class="pi-effect__hint" :title="`未注册的${title}：${unknownPreset.id}`">
        未注册
      </span>
    </header>

    <div v-if="visiblePresets.length" class="pi-effect__options" role="radiogroup" :aria-label="title">
      <button
        v-for="preset in visiblePresets"
        :key="preset.id"
        class="pi-effect__option"
        :class="{ 'pi-effect__option--selected': isSelected(preset) }"
        type="button"
        role="radio"
        :aria-checked="isSelected(preset)"
        :title="preset.label"
        @click="emit('changePreset', preset)"
      >
        {{ preset.label }}
      </button>
    </div>
    <p v-else class="pi-effect__empty">
      宿主未提供可选{{ title }}
    </p>

    <NumberField
      v-if="kind === 'filter'"
      label="强度"
      :model-value="intensity"
      :min="0" :max="1" :step="0.01" slider
      @update:model-value="value => emit('changeIntensity', value)"
    />
  </section>
</template>

<style scoped>
/* Geometry follows the spec's 节点编辑面板 rules: radius 12, padding 16,
   group gap 12, option rows 32px tall with radius 8. */
.pi-effect {
  --at-apply: flex flex-col;
  gap: var(--ve-panel-group-gap, 12px);
  padding: var(--ve-panel-padding, 16px);
  border-radius: var(--ve-panel-radius, 12px);
  background: var(--ve-panel-background, #fff);
  box-shadow:
    inset 0 0 0 var(--ve-stroke-width, 0.5px) var(--ve-panel-border, rgba(0, 0, 0, 0.12)),
    var(--ve-shadow-floating, none);
}

.pi-effect .pi-effect__header {
  --at-apply: flex items-center justify-between gap-2;
}

.pi-effect .pi-effect__title {
  --at-apply: m-0 font-medium;
  font-size: 14px;
  line-height: 22px;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}

.pi-effect .pi-effect__hint {
  font-size: 10px;
  line-height: 16px;
  color: var(--ve-content-tertiary, rgba(0, 0, 0, 0.35));
}

.pi-effect .pi-effect__options {
  --at-apply: grid gap-0.5;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
}

.pi-effect .pi-effect__option {
  --at-apply: cursor-pointer border-none truncate text-center;
  height: var(--ve-option-height, 32px);
  padding: 0 var(--ve-option-padding-x, 8px);
  border-radius: var(--ve-option-radius, 8px);
  font-size: 12px;
  line-height: 20px;
  color: var(--ve-content-primary, rgba(0, 0, 0, 0.9));
  background: var(--ve-option-background, transparent);
  transition: background-color 150ms;
}

.pi-effect .pi-effect__option:hover {
  background: var(--ve-option-hover-background, rgba(0, 0, 0, 0.05));
}

.pi-effect .pi-effect__option--selected {
  background: var(--ve-option-selected-background, #f0f0f0);
  box-shadow: var(--ve-option-selected-inset, inset 0 0 0 1px rgba(0, 0, 0, 0.08));
}

.pi-effect .pi-effect__empty {
  --at-apply: m-0;
  font-size: 12px;
  line-height: 20px;
  color: var(--ve-content-tertiary, rgba(0, 0, 0, 0.35));
}
</style>
