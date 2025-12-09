import type { App } from 'vue'
import VideoEditorTimeline from './VideoEditorTimeline/index.vue'
import VideoTimeline from './VideoTimeline/index.vue'

export * from './VideoTimeline/types'

// 导出单独组件
export { VideoEditorTimeline, VideoTimeline }

export default {
  install(app: App): void {
    // Vue SFC name is optional; fall back to explicit strings to satisfy typings.
    app.component(VideoTimeline.name || 'VeVideoTimeline', VideoTimeline)
    app.component(VideoEditorTimeline.name || 'VeVideoEditorTimeline', VideoEditorTimeline)
  },
}
