<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import App from './App.vue'
import { migrateLegacyLabUrl, resolvePlaygroundRoute } from './router'
import ShaderLab from './ShaderLab.vue'
import TranscodeLab from './TranscodeLab.vue'

defineOptions({ name: 'PlaygroundRouter' })

migrateLegacyLabUrl()
const route = ref(resolvePlaygroundRoute())

function updateRoute() {
  route.value = resolvePlaygroundRoute()
}

onMounted(() => window.addEventListener('popstate', updateRoute))
onBeforeUnmount(() => window.removeEventListener('popstate', updateRoute))
</script>

<template>
  <TranscodeLab v-if="route === 'transcode'" />
  <ShaderLab v-else-if="route === 'shaders'" />
  <App v-else />
</template>
