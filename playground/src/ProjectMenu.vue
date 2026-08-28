<script setup lang="ts">
import type { ProjectMeta } from '@video-editor/protocol'
import { nextTick, ref, watch } from 'vue'

defineOptions({ name: 'ProjectMenu' })

const props = defineProps<{
  projects: ProjectMeta[]
  currentId: string
  currentName: string
  /** Epoch ms of the last autosave, `null` before the first one. */
  savedAt: number | null
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'create'): void
  (event: 'rename', name: string): void
  (event: 'delete', id: string): void
}>()

const open = ref(false)
const renaming = ref(false)
const draftName = ref(props.currentName)
/** Id awaiting a second click to confirm its deletion. */
const pendingDeleteId = ref<string | null>(null)

watch(() => props.currentName, (name) => {
  if (!renaming.value)
    draftName.value = name
})

function toggle() {
  open.value = !open.value
  if (!open.value)
    resetTransientState()
}

function close() {
  open.value = false
  resetTransientState()
}

function resetTransientState() {
  renaming.value = false
  pendingDeleteId.value = null
  draftName.value = props.currentName
}

const renameInput = ref<HTMLInputElement | null>(null)

function startRename() {
  draftName.value = props.currentName
  renaming.value = true
  void nextTick(() => renameInput.value?.focus())
}

function cancelRename() {
  draftName.value = props.currentName
  renaming.value = false
}

function commitRename() {
  const name = draftName.value.trim()
  renaming.value = false
  if (!name || name === props.currentName)
    return
  emit('rename', name)
}

function select(id: string) {
  if (id === props.currentId) {
    close()
    return
  }
  close()
  emit('select', id)
}

function create() {
  close()
  emit('create')
}

function requestDelete(id: string) {
  // Two-step confirm: the first click arms the row, the second deletes it.
  if (pendingDeleteId.value !== id) {
    pendingDeleteId.value = id
    return
  }
  pendingDeleteId.value = null
  close()
  emit('delete', id)
}

function formatRelative(timestamp: number) {
  const diff = Date.now() - timestamp
  if (diff < 60_000)
    return '刚刚'
  if (diff < 3_600_000)
    return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000)
    return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="project">
    <button class="project__trigger" :class="{ 'project__trigger--open': open }" title="项目" @click="toggle">
      <span class="project__name">{{ currentName }}</span>
      <span class="project__caret" aria-hidden="true">▾</span>
    </button>
    <span v-if="savedAt" class="project__saved mono">已保存 {{ formatClock(savedAt) }}</span>

    <template v-if="open">
      <div class="project__backdrop" @click="close" />
      <div class="project__menu">
        <div class="project__section">
          <template v-if="renaming">
            <input
              ref="renameInput"
              v-model="draftName"
              class="project__input"
              @keydown.enter="commitRename"
              @keydown.esc="cancelRename"
              @blur="commitRename"
            >
          </template>
          <button v-else class="tool project__action" @click="startRename">
            重命名当前项目
          </button>
          <button class="tool project__action" @click="create">
            新建项目
          </button>
        </div>

        <ul class="project__list">
          <li v-for="item in projects" :key="item.id" class="project__item" :class="{ 'project__item--active': item.id === currentId }">
            <button class="project__pick" @click="select(item.id)">
              <span class="project__item-name">{{ item.name }}</span>
              <span class="project__item-time mono">{{ formatRelative(item.updatedAt) }}</span>
            </button>
            <button
              class="tool tool--danger project__delete"
              :class="{ 'project__delete--armed': pendingDeleteId === item.id }"
              @click="requestDelete(item.id)"
            >
              {{ pendingDeleteId === item.id ? '确认' : '删除' }}
            </button>
          </li>
          <li v-if="!projects.length" class="project__empty">
            暂无已保存项目
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
