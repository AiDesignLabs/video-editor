import type { App } from 'vue'
import CanvasSizePanel from './CanvasSizePanel/index.vue'
import PropertyInspector from './PropertyInspector/index.vue'
import TimelineToolbarButton from './timeline/TimelineToolbarButton.vue'
import VideoEditorTimeline from './VideoEditorTimeline/index.vue'
import VideoTimeline from './VideoTimeline/index.vue'
import './theme.css'
// Utilities scanned out of this package's own templates — the `i-creatly-*`
// icons above all. Bundled here so `@video-editor/ui/style.css` is complete on
// its own, instead of relying on the consumer's UnoCSS scanning our dist.
import 'uno.css'

export { CANVAS_SIZE_PRESETS, formatAspectRatio, matchPreset, orientationOf } from './CanvasSizePanel/presets'
export type { CanvasSizePreset } from './CanvasSizePanel/presets'

export type { EffectPreset, SegmentUpdater } from './PropertyInspector/types'

export {
  createDefaultToolbarActions,
  mergeToolbarActions,
  resolveToolbarGroup,
} from './timeline/toolbar-actions'

export type {
  DefaultToolbarActionId,
  DefaultToolbarActionsContext,
  ToolbarAction,
  ToolbarActionGroup,
  ToolbarActionPatch,
  ToolbarActionPlacement,
  ToolbarButtonAction,
  ToolbarDividerAction,
  ToolbarSlotAction,
  ToolbarStatusAction,
  ToolbarZoomAction,
} from './timeline/toolbar-actions'

export * from './VideoEditorTimeline/segments'
export type { TransitionEditPayload, TransitionSeam } from './VideoEditorTimeline/types'

export * from './VideoTimeline/types'

// 导出单独组件
export { CanvasSizePanel, PropertyInspector, TimelineToolbarButton, VideoEditorTimeline, VideoTimeline }

export default {
  install(app: App): void {
    // Vue SFC name is optional; fall back to explicit strings to satisfy typings.
    app.component(VideoTimeline.name || 'VeVideoTimeline', VideoTimeline)
    app.component(VideoEditorTimeline.name || 'VeVideoEditorTimeline', VideoEditorTimeline)
  },
}
