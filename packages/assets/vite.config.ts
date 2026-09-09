import type { BrowserProviderOption } from 'vitest/node'
import { fileURLToPath } from 'node:url'
import { playwright } from '@vitest/browser-playwright'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vitest/config'

const browserProvider = playwright() as BrowserProviderOption

export default defineConfig({
  worker: {
    format: 'es',
  },
  plugins: [dts({
    tsconfigPath: './tsconfig.build.json',
    include: ['src'],
    outDirs: 'dist',
    insertTypesEntry: true,
    bundleTypes: false,
    copyDtsFiles: false,
  })],
  build: {
    lib: {
      entry: {
        'index': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'media-worker/index': fileURLToPath(new URL('./src/media-worker/index.ts', import.meta.url)),
        'worker/index': fileURLToPath(new URL('./src/worker/index.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    target: 'esnext',
    sourcemap: true,
    rollupOptions: { external: ['@video-editor/media', 'idb', 'opfs-tools'] },
  },
  test: {
    globals: true,
    projects: [
      { test: { name: 'node', globals: true, environment: 'node', include: ['src/**/*.test.ts'], exclude: ['src/**/*.browser.test.ts'] } },
      { test: { name: 'browser', globals: true, include: ['src/**/*.browser.test.ts'], browser: { enabled: true, headless: true, provider: browserProvider, api: { host: '127.0.0.1', port: 0, strictPort: false }, instances: [{ browser: 'chromium', name: 'chromium' }] } } },
    ],
  },
})
