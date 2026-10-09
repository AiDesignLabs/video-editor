<script setup lang="ts">
import type { EffectDefinition, PresetPreview, TransitionDefinition } from '@video-editor/renderer'
import { createPresetPreview, listEffectDefinitions, listTransitionDefinitions } from '@video-editor/renderer'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { navigatePlayground } from './router'

defineOptions({ name: 'ShaderLab' })

type LabMode = 'effects' | 'transitions'

const mode = ref<LabMode>('effects')
const canvas = ref<HTMLCanvasElement | null>(null)
const selectedId = ref('sharpen')
const customEffects = listEffectDefinitions().filter(definition => Boolean(definition.fragment))
const transitions = listTransitionDefinitions()
const definitions = computed<(EffectDefinition | TransitionDefinition)[]>(() => mode.value === 'effects' ? customEffects : transitions)
const selected = computed(() => definitions.value.find(definition => definition.id === selectedId.value) ?? definitions.value[0])

let preview: PresetPreview | undefined
let disposed = false

function selectMode(nextMode: LabMode) {
  mode.value = nextMode
  selectedId.value = nextMode === 'effects' ? customEffects[0]?.id ?? '' : transitions[0]?.id ?? ''
}

async function renderSelected() {
  if (!preview || !selected.value)
    return
  if (mode.value === 'effects') {
    const definition = selected.value as EffectDefinition
    preview.render(definition, { kind: definition.kind === 'effect' ? 'effect' : 'filter', intensity: 0.8 })
  }
  else {
    const definition = selected.value as TransitionDefinition
    preview.render(definition, { kind: 'transition' })
  }
}

onMounted(async () => {
  if (!canvas.value)
    return
  const created = await createPresetPreview({ canvas: canvas.value, width: 640, height: 360 })
  if (disposed) {
    created.destroy()
    return
  }
  preview = created
  await nextTick()
  await renderSelected()
})

watch([mode, selectedId], () => void renderSelected())

onBeforeUnmount(() => {
  disposed = true
  preview?.destroy()
  preview = undefined
})
</script>

<template>
  <main class="shader-lab">
    <header class="shader-lab__header">
      <div>
        <button class="shader-lab__back" type="button" @click="navigatePlayground('/')">
          返回编辑器
        </button>
        <h1>Shader Lab</h1>
        <p>独立调试自建 Shader。右侧预览使用真实 Pixi WebGL 管线。</p>
      </div>
      <nav class="shader-lab__nav" aria-label="Shader category">
        <button :class="{ active: mode === 'effects' }" type="button" @click="selectMode('effects')">
          滤镜 / 特效
        </button>
        <button :class="{ active: mode === 'transitions' }" type="button" @click="selectMode('transitions')">
          转场
        </button>
      </nav>
    </header>

    <section class="shader-lab__body">
      <aside class="shader-lab__list">
        <button
          v-for="definition in definitions"
          :key="definition.id"
          class="shader-lab__item"
          :class="{ active: definition.id === selected?.id }"
          type="button"
          @click="selectedId = definition.id"
        >
          <strong>{{ definition.label }}</strong>
          <code>{{ definition.id }}</code>
        </button>
      </aside>

      <section class="shader-lab__preview">
        <canvas ref="canvas" width="640" height="360" aria-label="Shader preview" />
        <div class="shader-lab__meta">
          <strong>{{ selected?.label }}</strong>
          <code>{{ selected?.id }}</code>
        </div>
        <pre>{{ selected?.fragment }}</pre>
      </section>
    </section>
  </main>
</template>

<style scoped>
.shader-lab {
  min-height: 100vh;
  padding: 32px;
  color: #e5e7eb;
  background: #111827;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.shader-lab__header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  max-width: 1280px;
  margin: 0 auto 24px;
}
.shader-lab h1 {
  margin: 12px 0 4px;
  font-size: 30px;
}
.shader-lab p {
  margin: 0;
  color: #9ca3af;
}
.shader-lab__back,
.shader-lab__nav button {
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 8px 12px;
  color: #d1d5db;
  background: #1f2937;
  cursor: pointer;
}
.shader-lab__nav {
  display: flex;
  align-items: end;
  gap: 8px;
}
.shader-lab__nav button.active,
.shader-lab__item.active {
  border-color: #60a5fa;
  background: #1e3a5f;
}
.shader-lab__body {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px;
  max-width: 1280px;
  margin: 0 auto;
}
.shader-lab__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: calc(100vh - 170px);
  overflow: auto;
}
.shader-lab__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 10px 12px;
  color: #d1d5db;
  background: #1f2937;
  text-align: left;
  cursor: pointer;
}
.shader-lab__item code,
.shader-lab__meta code {
  color: #93c5fd;
  font-size: 11px;
}
.shader-lab__preview {
  min-width: 0;
}
.shader-lab__preview canvas {
  display: block;
  width: min(100%, 960px);
  height: auto;
  border-radius: 12px;
  background: #030712;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
.shader-lab__meta {
  display: flex;
  gap: 12px;
  align-items: baseline;
  margin: 14px 0 8px;
}
.shader-lab pre {
  max-height: 420px;
  overflow: auto;
  margin: 0;
  padding: 16px;
  border: 1px solid #374151;
  border-radius: 8px;
  color: #c4b5fd;
  background: #030712;
  font:
    12px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  white-space: pre-wrap;
}
@media (max-width: 820px) {
  .shader-lab {
    padding: 20px;
  }
  .shader-lab__header {
    flex-direction: column;
  }
  .shader-lab__body {
    grid-template-columns: 1fr;
  }
  .shader-lab__list {
    max-height: 240px;
  }
}
</style>
