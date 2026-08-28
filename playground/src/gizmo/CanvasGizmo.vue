<script setup lang="ts">
import type { Renderer, VisualBox } from '@video-editor/renderer'
import type { GizmoTransformPatch } from './types'
import {
  hitTestBoxes,
  normalizeRotationDeg,
  positionFromCenter,
  scaleFromSize,
  snapRotationDeg,
} from '@video-editor/renderer'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ name: 'CanvasGizmo' })

const props = defineProps<{
  renderer: Renderer | null
  selectedSegmentId: string | null
  currentTimeMs: number
  isPlaying: boolean
}>()

const emit = defineEmits<{
  (e: 'select', segmentId: string | null): void
  (e: 'transform', patch: GizmoTransformPatch): void
}>()

const ROTATION_SNAP_DEG = 15
const ROTATION_HANDLE_OFFSET_PX = 28
const BOX_POLL_INTERVAL_MS = 100

type Corner = 'nw' | 'ne' | 'se' | 'sw'
type DragMode = { kind: 'move' } | { kind: 'scale', corner: Corner } | { kind: 'rotate' }

interface StageMapping {
  /** Canvas offset relative to the overlay root, in CSS px. */
  offsetX: number
  offsetY: number
  /** CSS px per logical stage px. */
  scale: number
  stageWidth: number
  stageHeight: number
}

const root = ref<HTMLDivElement | null>(null)
const boxes = ref<VisualBox[]>([])
const mapping = ref<StageMapping>({ offsetX: 0, offsetY: 0, scale: 1, stageWidth: 0, stageHeight: 0 })
/** Optimistic box shown while dragging, before the protocol round-trip lands. */
const previewBox = ref<VisualBox | null>(null)

const selectedBox = computed(() => {
  if (props.isPlaying || !props.selectedSegmentId)
    return null
  if (previewBox.value && previewBox.value.segmentId === props.selectedSegmentId)
    return previewBox.value
  return boxes.value.find(box => box.segmentId === props.selectedSegmentId) ?? null
})

const boxStyle = computed(() => {
  const box = selectedBox.value
  if (!box)
    return undefined
  const map = mapping.value
  return {
    left: `${map.offsetX + box.centerX * map.scale}px`,
    top: `${map.offsetY + box.centerY * map.scale}px`,
    width: `${Math.max(Math.abs(box.width) * map.scale, 1)}px`,
    height: `${Math.max(Math.abs(box.height) * map.scale, 1)}px`,
    transform: `translate(-50%, -50%) rotate(${box.rotationRad}rad)`,
  }
})

const rotationHandleStyle = computed(() => ({ top: `${-ROTATION_HANDLE_OFFSET_PX}px` }))

function readMapping(renderer: Renderer): StageMapping | null {
  const host = root.value
  const canvas = renderer.app.canvas
  if (!host || !canvas.isConnected)
    return null
  const canvasRect = canvas.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  const stageWidth = renderer.app.renderer.width
  const stageHeight = renderer.app.renderer.height
  if (!canvasRect.width || !stageWidth)
    return null
  return {
    offsetX: canvasRect.left - hostRect.left,
    offsetY: canvasRect.top - hostRect.top,
    scale: canvasRect.width / stageWidth,
    stageWidth,
    stageHeight,
  }
}

function boxSignature(list: VisualBox[]) {
  return list
    .map(box => `${box.segmentId}:${box.centerX.toFixed(2)}:${box.centerY.toFixed(2)}:${box.width.toFixed(2)}:${box.height.toFixed(2)}:${box.rotationRad.toFixed(4)}:${box.zOrder}`)
    .join('|')
}

let lastSignature = ''

function refresh() {
  const renderer = props.renderer
  if (!renderer) {
    boxes.value = []
    lastSignature = ''
    return
  }
  const map = readMapping(renderer)
  if (map)
    mapping.value = map
  const next = renderer.getVisualBoxes()
  const signature = boxSignature(next)
  if (signature === lastSignature)
    return
  lastSignature = signature
  boxes.value = next
}

const pollTimer = window.setInterval(() => {
  if (!drag)
    refresh()
}, BOX_POLL_INTERVAL_MS)

watch(
  () => [props.renderer, props.selectedSegmentId, props.currentTimeMs, props.isPlaying] as const,
  () => refresh(),
  { immediate: true },
)

/** Convert a client point into logical stage coordinates. */
function toStagePoint(event: PointerEvent) {
  const renderer = props.renderer
  if (!renderer)
    return null
  const canvasRect = renderer.app.canvas.getBoundingClientRect()
  if (!canvasRect.width || !canvasRect.height)
    return null
  const stageWidth = renderer.app.renderer.width
  const stageHeight = renderer.app.renderer.height
  return {
    x: ((event.clientX - canvasRect.left) / canvasRect.width) * stageWidth,
    y: ((event.clientY - canvasRect.top) / canvasRect.height) * stageHeight,
  }
}

interface DragState {
  mode: DragMode
  start: VisualBox
  startPointer: { x: number, y: number }
  pointerId: number
}

let drag: DragState | null = null
let pendingPatch: GizmoTransformPatch | null = null
let rafId = 0

function schedulePatch(patch: GizmoTransformPatch) {
  pendingPatch = patch
  if (rafId)
    return
  rafId = window.requestAnimationFrame(() => {
    rafId = 0
    const next = pendingPatch
    pendingPatch = null
    if (next)
      emit('transform', next)
  })
}

function flushPatch() {
  if (rafId) {
    window.cancelAnimationFrame(rafId)
    rafId = 0
  }
  const next = pendingPatch
  pendingPatch = null
  if (next)
    emit('transform', next)
}

function beginDrag(event: PointerEvent, mode: DragMode) {
  const box = selectedBox.value
  const pointer = toStagePoint(event)
  if (!box || !pointer)
    return
  event.preventDefault()
  event.stopPropagation()
  drag = { mode, start: { ...box }, startPointer: pointer, pointerId: event.pointerId }
  previewBox.value = { ...box }
  window.addEventListener('pointermove', handleDragMove)
  window.addEventListener('pointerup', handleDragEnd)
  window.addEventListener('pointercancel', handleDragEnd)
}

function handleDragMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId)
    return
  const pointer = toStagePoint(event)
  if (!pointer)
    return
  const { start, startPointer, mode } = drag
  const map = mapping.value

  if (mode.kind === 'move') {
    const centerX = start.centerX + (pointer.x - startPointer.x)
    const centerY = start.centerY + (pointer.y - startPointer.y)
    const position = positionFromCenter(centerX, centerY, map.stageWidth, map.stageHeight)
    previewBox.value = {
      ...start,
      centerX: map.stageWidth / 2 + (position.px * map.stageWidth) / 2,
      centerY: map.stageHeight / 2 - (position.py * map.stageHeight) / 2,
    }
    schedulePatch({
      segmentId: start.segmentId,
      segmentType: start.segmentType,
      position: { x: position.px, y: position.py },
      keyframed: start.hasTransformKeyframes,
    })
    return
  }

  if (mode.kind === 'scale') {
    const localStart = rotateInto(start, startPointer)
    const localNow = rotateInto(start, pointer)
    const startDistance = Math.hypot(localStart.x, localStart.y)
    let ratioX = 1
    let ratioY = 1
    if (event.shiftKey) {
      // Shift = free (per-axis) scaling.
      ratioX = Math.abs(localStart.x) > 1e-3 ? localNow.x / localStart.x : 1
      ratioY = Math.abs(localStart.y) > 1e-3 ? localNow.y / localStart.y : 1
    }
    else if (startDistance > 1e-3) {
      const ratio = Math.hypot(localNow.x, localNow.y) / startDistance
      ratioX = ratio
      ratioY = ratio
    }
    const finalWidth = Math.abs(start.width * ratioX)
    const finalHeight = Math.abs(start.height * ratioY)
    const scale = scaleFromSize(finalWidth, finalHeight, start.baseWidth, start.baseHeight)
    previewBox.value = {
      ...start,
      width: start.baseWidth * scale.sx,
      height: start.baseHeight * scale.sy,
    }
    schedulePatch({
      segmentId: start.segmentId,
      segmentType: start.segmentType,
      scale: { x: scale.sx, y: scale.sy },
      keyframed: start.hasTransformKeyframes,
    })
    return
  }

  const startAngle = Math.atan2(startPointer.y - start.centerY, startPointer.x - start.centerX)
  const nowAngle = Math.atan2(pointer.y - start.centerY, pointer.x - start.centerX)
  // Pixi rotates clockwise on the Y-down stage, matching the screen-space delta.
  const deltaDeg = ((nowAngle - startAngle) * 180) / Math.PI
  const rawDeg = normalizeRotationDeg(start.rotationRad) + deltaDeg
  const rotationDeg = event.shiftKey
    ? snapRotationDeg(rawDeg, ROTATION_SNAP_DEG)
    : snapRotationDeg(rawDeg, 0)
  previewBox.value = { ...start, rotationRad: (rotationDeg * Math.PI) / 180 }
  schedulePatch({
    segmentId: start.segmentId,
    segmentType: start.segmentType,
    rotationDeg,
    keyframed: start.hasTransformKeyframes,
  })
}

function handleDragEnd(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId)
    return
  drag = null
  window.removeEventListener('pointermove', handleDragMove)
  window.removeEventListener('pointerup', handleDragEnd)
  window.removeEventListener('pointercancel', handleDragEnd)
  flushPatch()
  previewBox.value = null
  refresh()
}

/** Rotate a stage point into the unrotated local space of `box`. */
function rotateInto(box: VisualBox, point: { x: number, y: number }) {
  const dx = point.x - box.centerX
  const dy = point.y - box.centerY
  const cos = Math.cos(-box.rotationRad)
  const sin = Math.sin(-box.rotationRad)
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}

function handleHitLayerPointerDown(event: PointerEvent) {
  if (props.isPlaying || !props.renderer)
    return
  const point = toStagePoint(event)
  if (!point)
    return
  refresh()
  const hit = hitTestBoxes(props.renderer.getVisualBoxes(), point.x, point.y)
  emit('select', hit?.segmentId ?? null)
}

onBeforeUnmount(() => {
  window.clearInterval(pollTimer)
  window.removeEventListener('pointermove', handleDragMove)
  window.removeEventListener('pointerup', handleDragEnd)
  window.removeEventListener('pointercancel', handleDragEnd)
  if (rafId)
    window.cancelAnimationFrame(rafId)
})
</script>

<template>
  <div ref="root" class="gizmo">
    <div class="gizmo__hit" @pointerdown="handleHitLayerPointerDown" />
    <div
      v-if="selectedBox"
      class="gizmo__box"
      :style="boxStyle"
      @pointerdown="beginDrag($event, { kind: 'move' })"
    >
      <span
        v-for="corner in (['nw', 'ne', 'se', 'sw'] as const)"
        :key="corner"
        class="gizmo__handle"
        :class="`gizmo__handle--${corner}`"
        @pointerdown="beginDrag($event, { kind: 'scale', corner })"
      />
      <span
        class="gizmo__rotate"
        :style="rotationHandleStyle"
        @pointerdown="beginDrag($event, { kind: 'rotate' })"
      />
    </div>
  </div>
</template>

<style scoped>
.gizmo {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

.gizmo__hit {
  position: absolute;
  inset: 0;
  pointer-events: auto;
}

.gizmo__box {
  position: absolute;
  box-sizing: border-box;
  border: 1px dashed var(--accent, #4f7dff);
  pointer-events: auto;
  cursor: move;
  touch-action: none;
}

.gizmo__handle {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px;
  background: #fff;
  border: 1px solid var(--accent, #4f7dff);
  pointer-events: auto;
  touch-action: none;
}

.gizmo__handle--nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}

.gizmo__handle--ne {
  top: 0;
  left: 100%;
  cursor: nesw-resize;
}

.gizmo__handle--se {
  top: 100%;
  left: 100%;
  cursor: nwse-resize;
}

.gizmo__handle--sw {
  top: 100%;
  left: 0;
  cursor: nesw-resize;
}

.gizmo__rotate {
  position: absolute;
  left: 50%;
  width: 10px;
  height: 10px;
  margin: -5px;
  border-radius: 50%;
  background: var(--accent, #4f7dff);
  border: 1px solid #fff;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}
</style>
