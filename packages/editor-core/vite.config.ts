import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.build.json',
      include: ['src'],
      outDirs: 'dist',
      insertTypesEntry: true,
      bundleTypes: {
        invokeOptions: { typescriptCompilerFolder: undefined },
      },
      copyDtsFiles: false,
    }),
  ],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        '@vue/reactivity',
        '@video-editor/protocol',
        '@video-editor/shared',
      ],
      output: {
        preserveModules: false,
      },
    },
  },
})
