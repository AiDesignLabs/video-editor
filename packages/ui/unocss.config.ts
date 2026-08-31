import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  content: {
    pipeline: {
      // The default toolbar's icon classes live in `timeline/toolbar-actions.ts`
      // as plain strings, and UnoCSS does not scan `.ts` out of the box.
      include: [/\.(vue|[jt]sx?)($|\?)/],
    },
  },
  // The generated utilities are bundled into the package's own stylesheet (see
  // the `uno.css` import in src/index.ts). A library must not ship a reset —
  // `* { margin: 0; padding: 0; border: 0 }` would restyle the consumer's whole
  // page — so presetWind4's reset is switched off below. Its theme preflight
  // stays: the compiled `--at-apply` output reads `var(--spacing)` and friends.
  preflights: [],
  presets: [
    presetWind4({ preflights: { reset: false } }),
    presetAttributify({}),
    presetIcons({
      warn: true,
      collections: {
        creatly: () => import('@creatly/figma-icons/json/icons.json').then(i => i.default),
      },
    }),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})
