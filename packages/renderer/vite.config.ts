import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      tsconfigPath: './tsconfig.build.json',
      include: ['src', '2d'],
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: true,
      copyDtsFiles: false,
    }),
  ],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
    },
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      external: [
        'pixi.js',
        '@vue/reactivity',
        '@video-editor/shared',
        '@video-editor/protocol',
        '@webav/av-cliper',
        'opfs-tools',
      ],
    },
  },
})
