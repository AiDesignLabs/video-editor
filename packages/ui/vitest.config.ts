import type { BrowserProviderOption } from 'vitest/node'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const browserProvider = playwright() as BrowserProviderOption

export default defineConfig({
  // Needed by the toolbar render tests, which mount real SFCs through
  // `vue/server-renderer` rather than pulling in a DOM environment.
  plugins: [vue()],
  test: {
    globals: true,
    projects: [
      {
        plugins: [vue()],
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        // Anything that needs real DOM events — bubbling, focus, `change` on a
        // committed slider — runs in Chromium rather than a DOM shim, so the
        // test exercises the same behaviour the browser gives users.
        plugins: [vue()],
        test: {
          name: 'dom',
          globals: true,
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: browserProvider,
            api: { host: '127.0.0.1', port: 0, strictPort: false },
            instances: [{ browser: 'chromium', name: 'dom-chromium' }],
          },
        },
      },
    ],
  },
})
