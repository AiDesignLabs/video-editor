import type { BrowserProviderOption } from 'vitest/node'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vitest/config'

const browserProvider = playwright() as BrowserProviderOption

export default defineConfig({
  plugins: [
    vue(),
    dts({
      tsconfigPath: './tsconfig.build.json',
      include: ['src', '../../types/mp4box.d.ts'],
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
  },
  test: {
    globals: true,
    api: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
    browser: {
      enabled: true,
      headless: false,
      provider: browserProvider,
      api: {
        host: '127.0.0.1',
        port: 0, // use a random free port to avoid bind failures in restricted envs
        strictPort: false,
      },
      instances: [
        {
          browser: 'chromium',
          name: 'chromium',
        },
      ],
    },
  },
})
