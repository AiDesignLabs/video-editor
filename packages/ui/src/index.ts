import type { App } from 'vue'
import Button from './Button/index.vue'
import Text from './Text/index.vue'

// 导出单独组件
export { Button, Text }

// 编写一个插件，实现一个install方法

// console.log('Button', Button.name)

export default {
  install(app: App): void {
    // Vue SFC name is optional; fall back to explicit strings to satisfy typings.
    app.component(Button.name || 'VeButton', Button)
    app.component(Text.name || 'VeText', Text)
  },
}
