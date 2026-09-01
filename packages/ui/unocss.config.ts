import type { Postprocessor } from 'unocss'
import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

const lowerGlobalUtilitySpecificity: Postprocessor = (utility) => {
  if (!utility.selector.trimStart().startsWith('@'))
    utility.selector = `:where(${utility.selector})`
}

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
  // Library utilities are global because consumers load the compiled CSS. Keep
  // them at zero specificity so the host's own utility classes always win,
  // independent of stylesheet load order.
  postprocess: [lowerGlobalUtilitySpecificity],
  // Preserve UnoCSS's native layers in the published stylesheet. Consumers
  // that also use UnoCSS can then keep icons below sizing utilities instead of
  // having an unlayered library rule outrank every host layer.
  outputToCssLayers: true,
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
