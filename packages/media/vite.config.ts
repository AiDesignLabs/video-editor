import { fileURLToPath } from 'node:url'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.build.json',
      include: ['src'],
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
        'mediabunny',
      ],
    },
  },
  test: {
    globals: true,
  },
})
