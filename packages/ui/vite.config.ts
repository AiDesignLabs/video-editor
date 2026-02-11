import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const componentMap: Record<string, string> = {}

fs.readdirSync(path.resolve(__dirname, 'src')).forEach((name) => {
  const componentDir = path.resolve(__dirname, 'src', name)
  const isDir = fs.lstatSync(componentDir).isDirectory()
  if (isDir && fs.readdirSync(componentDir).includes('index.vue'))
    componentMap[name] = fileURLToPath(new URL(`./src/${name}/index.vue`, import.meta.url))
})

export default defineConfig({
  plugins: [
    UnoCSS({
      configFile: fileURLToPath(new URL('./unocss.config.ts', import.meta.url)),
    }),
    vue(),
    dts({
      tsconfigPath: './tsconfig.build.json',
      include: ['src'],
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: true,
      copyDtsFiles: false,
    }),
  ],
  resolve: {
    alias: {
    },
  },
  build: {
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        ...componentMap,
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['vue', '@video-editor/protocol', '@video-editor/shared'],
      output: {
        assetFileNames: '[name].[ext]',
        exports: 'named',
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
})
