<script setup lang="ts">
defineOptions({ name: 'TimelinePlayhead' })

defineProps<{
  left: number
}>()

const emit = defineEmits<{
  (e: 'dragStart', event: MouseEvent): void
}>()
</script>

<template>
  <div
    class="ve-playhead"
    :style="{ left: `${left}px` }"
    @mousedown.stop.prevent="emit('dragStart', $event)"
  >
    <svg class="ve-playhead__icon" width="12" height="18" viewBox="0 0 12 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#ve_playhead_drop_shadow)">
        <path d="M2 3C2 1.89543 2.89543 1 4 1H8C9.10457 1 10 1.89543 10 3V11.0925C10 11.6692 9.75104 12.2178 9.31701 12.5976L7.31701 14.3476C6.56296 15.0074 5.43704 15.0074 4.68299 14.3476L2.68299 12.5976C2.24896 12.2178 2 11.6692 2 11.0925V3Z" fill="white" />
        <path d="M4 1.5H8C8.82843 1.5 9.5 2.17157 9.5 3V11.0928C9.49991 11.5252 9.31275 11.9369 8.9873 12.2217L6.9873 13.9717C6.42191 14.466 5.57809 14.466 5.0127 13.9717L3.0127 12.2217C2.68725 11.9369 2.50009 11.5252 2.5 11.0928V3C2.5 2.17157 3.17157 1.5 4 1.5Z" stroke="currentColor" />
      </g>
      <defs>
        <filter id="ve_playhead_drop_shadow" x="0" y="0" width="12" height="17.8428" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feFlood flood-opacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="1" />
          <feGaussianBlur stdDeviation="1" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
      </defs>
    </svg>
    <div class="ve-playhead__line" />
  </div>
</template>

<style scoped>
:where(.ve-playhead) {
  --ve-playhead-nudge: 0px;
  --at-apply: absolute z-20 pointer-events-auto cursor-ew-resize h-full;
  transform: translateX(calc(-50% - var(--ve-playhead-nudge)));
}

:where(.ve-playhead__icon) {
  --at-apply: text-[#222226] pointer-events-none relative z-2;
}

:where(.ve-playhead__line) {
  --at-apply: bg-[#222226] bottom-0 w-px translate-x--50% left-50% top-2px absolute pointer-events-none;
}
</style>
