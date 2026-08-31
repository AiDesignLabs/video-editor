import type { App } from 'vue'
import PropertyInspector from './PropertyInspector/index.vue'
import VideoEditorTimeline from './VideoEditorTimeline/index.vue'
import VideoTimeline from './VideoTimeline/index.vue'
import './theme.css'

export type { EffectPreset, SegmentUpdater } from './PropertyInspector/types'

export * from './VideoEditorTimeline/segments'

export type { TransitionEditPayload, TransitionSeam } from './VideoEditorTimeline/types'

export * from './VideoTimeline/types'

// 导出单独组件
export { PropertyInspector, VideoEditorTimeline, VideoTimeline }

export default {
  install(app: App): void {
    // Vue SFC name is optional; fall back to explicit strings to satisfy typings.
    app.component(VideoTimeline.name || 'VeVideoTimeline', VideoTimeline)
    app.component(VideoEditorTimeline.name || 'VeVideoEditorTimeline', VideoEditorTimeline)
  },
}
