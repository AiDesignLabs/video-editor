<script setup lang="ts">
import type { ToolbarAction, ToolbarActionGroup } from './toolbar-actions'
import { computed } from 'vue'
import TimelineToolbarAction from './TimelineToolbarAction.vue'
import TimelineZoomControl from './TimelineZoomControl.vue'
import { resolveToolbarGroup } from './toolbar-actions'

defineOptions({ name: 'TimelineToolbar' })

const props = withDefaults(defineProps<{
  zoom: number
  minZoom?: number
  maxZoom?: number
  currentTime?: number
  duration?: number
  formatTime?: (ms: number) => string
  /** Hide the built-in zoom slider when the host supplies its own. */
  showZoomSlider?: boolean
  /**
   * Declarative contents — see `toolbar-actions.ts`. When omitted the toolbar
   * keeps its legacy shape (empty side zones plus the zoom cluster on the
   * right), so embeds that drive it purely through slots are unaffected.
   */
  actions?: ToolbarAction[]
}>(), {
  minZoom: 0.25,
  maxZoom: 10,
  currentTime: 0,
  duration: 0,
  formatTime: (ms: number) => `${(ms / 1000).toFixed(2)}s`,
  showZoomSlider: true,
  actions: undefined,
})

const emit = defineEmits<{
  (e: 'zoomIn'): void
  (e: 'zoomOut'): void
  (e: 'update:zoom', zoom: number): void
}>()

function useGroup(name: ToolbarActionGroup) {
  return computed(() => props.actions ? resolveToolbarGroup(props.actions, name) : [])
}

const leftActions = useGroup('left')
const centerActions = useGroup('center')
const rightActions = useGroup('right')

/** Forwarded verbatim to every rendered action, which needs the zoom context. */
const zoomBindings = computed(() => ({
  zoom: props.zoom,
  minZoom: props.minZoom,
  maxZoom: props.maxZoom,
  showZoomSlider: props.showZoomSlider,
}))
</script>

<template>
  <div class="ve-toolbar">
    <div class="ve-toolbar__group ve-toolbar__group--left">
      <slot name="left-actions">
        <template v-for="action in leftActions" :key="action.id">
          <slot :name="`action-${action.id}`" :action="action">
            <TimelineToolbarAction
              :action="action"
              v-bind="zoomBindings"
              @zoom-in="emit('zoomIn')"
              @zoom-out="emit('zoomOut')"
              @update:zoom="emit('update:zoom', $event)"
            >
              <template v-if="$slots.button" #button="s">
                <slot name="button" v-bind="s" />
              </template>
            </TimelineToolbarAction>
          </slot>
        </template>
      </slot>
    </div>

    <div class="ve-toolbar__group ve-toolbar__group--center">
      <slot name="center">
        <template v-for="action in centerActions" :key="action.id">
          <slot :name="`action-${action.id}`" :action="action">
            <TimelineToolbarAction
              :action="action"
              v-bind="zoomBindings"
              @zoom-in="emit('zoomIn')"
              @zoom-out="emit('zoomOut')"
              @update:zoom="emit('update:zoom', $event)"
            >
              <template v-if="$slots.button" #button="s">
                <slot name="button" v-bind="s" />
              </template>
            </TimelineToolbarAction>
          </slot>
        </template>

        <div class="ve-toolbar__time">
          <slot name="time" :current-time="currentTime" :duration="duration">
            <span>{{ formatTime?.(currentTime || 0) }}</span>
            <span class="ve-toolbar__time-divider">/</span>
            <span>{{ formatTime?.(duration || 0) }}</span>
          </slot>
        </div>
      </slot>
    </div>

    <div class="ve-toolbar__group ve-toolbar__group--right">
      <!-- Prepend point: lets a consumer add controls ahead of the zoom cluster
           without having to override `right-actions` and reimplement zoom. -->
      <slot name="right-actions-leading" />

      <slot name="right-actions">
        <template v-if="actions">
          <template v-for="action in rightActions" :key="action.id">
            <slot :name="`action-${action.id}`" :action="action">
              <TimelineToolbarAction
                :action="action"
                v-bind="zoomBindings"
                @zoom-in="emit('zoomIn')"
                @zoom-out="emit('zoomOut')"
                @update:zoom="emit('update:zoom', $event)"
              >
                <template v-if="$slots.button" #button="s">
                  <slot name="button" v-bind="s" />
                </template>
              </TimelineToolbarAction>
            </slot>
          </template>
        </template>

        <!-- No action list, so the zoom cluster stays the right zone's default. -->
        <TimelineZoomControl
          v-else
          :zoom="zoom"
          :min-zoom="minZoom"
          :max-zoom="maxZoom"
          :show-slider="showZoomSlider"
          @zoom-in="emit('zoomIn')"
          @zoom-out="emit('zoomOut')"
          @update:zoom="emit('update:zoom', $event)"
        />
      </slot>

      <slot name="right-actions-trailing" />
    </div>
  </div>
</template>

<style scoped>
.ve-toolbar {
  --at-apply: flex items-center;
  gap: var(--ve-toolbar-gap, 8px);
  height: var(--ve-toolbar-height, 46px);
  padding: 0 var(--ve-timeline-padding, 8px);
}

.ve-toolbar .ve-toolbar__group {
  --at-apply: inline-flex items-center;
  gap: var(--ve-toolbar-gap, 8px);
  height: var(--ve-btn-size, 24px);
}

.ve-toolbar .ve-toolbar__group--left {
  --at-apply: flex-1 justify-start min-w-0;
}

.ve-toolbar .ve-toolbar__group--center {
  --at-apply: justify-center shrink-0;
}

.ve-toolbar .ve-toolbar__group--right {
  --at-apply: flex-1 justify-end min-w-0;
}

/* `.ve-btn` / `.ve-toolbar-divider` / `.ve-toolbar-status` live in theme.css so
   slotted content can use them too — see the comment there. */

/* Time readout ----------------------------------------------------------- */

.ve-toolbar .ve-toolbar__time {
  --at-apply: inline-flex items-center gap-1 whitespace-nowrap;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--ve-content-primary, #222226);
  font-variant-numeric: tabular-nums;
}

.ve-toolbar .ve-toolbar__time-divider {
  color: var(--ve-content-tertiary, rgba(0, 0, 0, 0.35));
}
</style>
