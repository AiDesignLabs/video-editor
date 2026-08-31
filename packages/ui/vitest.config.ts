import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Needed by the toolbar render tests, which mount real SFCs through
  // `vue/server-renderer` rather than pulling in a DOM environment.
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
