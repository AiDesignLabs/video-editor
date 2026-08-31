import eslintConfig from '@antfu/eslint-config'

export default eslintConfig({
  formatters: true,
  unocss: true,
  vue: true,
}, {
  files: ['pnpm-workspace.yaml'],
  rules: {
    // pnpm 12 enforces trustPolicy on install. It flags chokidar@4.0.3 and
    // vite@6.4.1 as trust downgrades only because later releases moved to
    // OIDC publishing, so the policy is disabled here. Keep this override in
    // sync with pnpm-workspace.yaml, otherwise `eslint --fix` reverts it.
    'pnpm/yaml-enforce-settings': ['error', { settings: { shellEmulator: true, trustPolicy: 'off' } }],
  },
})
