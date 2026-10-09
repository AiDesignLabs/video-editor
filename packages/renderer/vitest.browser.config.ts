import type { BrowserProviderOption } from 'vitest/node'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright() as BrowserProviderOption,
      instances: [{ browser: 'chromium' }],
    },
  },
})
