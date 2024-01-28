import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { presetAttributify, presetUno } from 'unocss'

export default defineConfig({
  plugins: [
    vue(),
    UnoCSS({
      presets: [
        presetAttributify({ /* preset options */ }),
        presetUno(),
      ],
    })],
  server: {
    open: true,
  },
  resolve: {
    alias: {
      '@video-editor/ui': resolve(__dirname, '../packages/ui/src'),
    },
  },
  optimizeDeps: {
    exclude: ['@video-editor/ui'],
  },
})
