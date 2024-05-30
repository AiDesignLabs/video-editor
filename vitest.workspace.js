import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  './packages/editor/vite.config.ts',
  './packages/protocol/vite.config.ts',
  './packages/shared/vite.config.ts',
  './packages/plugins/vite.config.ts',
  './packages/renderer/vite.config.ts',
  './packages/ui/vite.config.ts',
  './playground/vite.config.ts',
])
