<script setup lang="ts">
import type { ITransform } from '@video-editor/shared'
import type { DeepReadonly } from 'vue'
import NumberField from '../NumberField.vue'

defineOptions({ name: 'PropertyInspectorTransformSection' })

const props = defineProps<{
  transform?: DeepReadonly<ITransform> | null
}>()

const emit = defineEmits<{
  (e: 'change', transform: ITransform): void
}>()

function currentTransform(): ITransform {
  const t = props.transform
  return {
    position: t ? [t.position[0], t.position[1], t.position[2]] : [0, 0, 0],
    rotation: t ? [t.rotation[0], t.rotation[1], t.rotation[2]] : [0, 0, 0],
    scale: t ? [t.scale[0], t.scale[1], t.scale[2]] : [1, 1, 1],
  }
}

function patch(apply: (draft: ITransform) => void) {
  const next = currentTransform()
  apply(next)
  emit('change', next)
}
</script>

<template>
  <div class="pi-transform">
    <div class="pi-transform__title">
      Transform
    </div>
    <NumberField
      label="X" :model-value="props.transform?.position[0] ?? 0"
      :min="-1" :max="1" :step="0.01" slider
      @update:model-value="value => patch(draft => draft.position[0] = value ?? 0)"
    />
    <NumberField
      label="Y" :model-value="props.transform?.position[1] ?? 0"
      :min="-1" :max="1" :step="0.01" slider
      @update:model-value="value => patch(draft => draft.position[1] = value ?? 0)"
    />
    <NumberField
      label="缩放 X" :model-value="props.transform?.scale[0] ?? 1"
      :min="0.01" :max="5" :step="0.01" slider
      @update:model-value="value => patch(draft => draft.scale[0] = value ?? 1)"
    />
    <NumberField
      label="缩放 Y" :model-value="props.transform?.scale[1] ?? 1"
      :min="0.01" :max="5" :step="0.01" slider
      @update:model-value="value => patch(draft => draft.scale[1] = value ?? 1)"
    />
    <NumberField
      label="旋转" :model-value="props.transform?.rotation[2] ?? 0"
      :min="0" :max="360" :step="1" slider
      @update:model-value="value => patch(draft => draft.rotation[2] = value ?? 0)"
    />
  </div>
</template>

<style scoped>
.pi-transform {
  --at-apply: flex flex-col gap-1.5;
}

.pi-transform .pi-transform__title {
  --at-apply: text-[11px] font-semibold uppercase tracking-wide;
  color: var(--ve-content-secondary, rgba(0, 0, 0, 0.55));
}
</style>
