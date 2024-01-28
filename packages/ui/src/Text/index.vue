<script setup lang="ts">
defineProps<{
  content: string
}>()
</script>

<template>
  <div>
    {{ content }}
  </div>
</template>
