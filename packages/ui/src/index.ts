import type { App } from 'vue'
import Button from './Button/index.vue'
import Text from './Text/index.vue'
import VideoEditorTimeline from './VideoEditorTimeline/index.vue'
import VideoTimeline from './VideoTimeline/index.vue'

export * from './VideoTimeline/types'

// 导出单独组件
export { Button, Text, VideoEditorTimeline, VideoTimeline }

export default {
  install(app: App): void {
    // Vue SFC name is optional; fall back to explicit strings to satisfy typings.
    app.component(Button.name || 'VeButton', Button)
    app.component(Text.name || 'VeText', Text)
    app.component(VideoTimeline.name || 'VeVideoTimeline', VideoTimeline)
    app.component(VideoEditorTimeline.name || 'VeVideoEditorTimeline', VideoEditorTimeline)
  },
}
