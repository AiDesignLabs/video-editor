import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    vue(),
    UnoCSS({
      configFile: resolve(__dirname, '../unocss.config.ts'),
    }),
  ],
  server: {
    open: true,
  },
  resolve: {
    alias: {
      '@video-editor/ui': resolve(__dirname, '../packages/ui/src'),
      '@video-editor/renderer': resolve(__dirname, '../packages/renderer/src'),
      '@video-editor/protocol': resolve(__dirname, '../packages/protocol/src'),
      '@video-editor/shared': resolve(__dirname, '../packages/shared/src'),
    },
  },
  optimizeDeps: {
    exclude: ['@video-editor/ui', '@video-editor/renderer', '@video-editor/protocol', '@video-editor/shared'],
  },
})
