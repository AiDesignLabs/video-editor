<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <button>
    {{ `${text} HMR` }}
  </button>
</template>
