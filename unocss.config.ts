import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetWebFonts,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  content: {
    pipeline: {
      /*
       * The playground resolves `@video-editor/ui` to its source, so this
       * config — not the package's own — generates the timeline's utilities.
       * The default toolbar's icon classes are plain strings in
       * `timeline/toolbar-actions.ts`, and UnoCSS does not scan `.ts` out of
       * the box, so without this every toolbar button renders blank.
       * `packages/ui/unocss.config.ts` carries the same include for the
       * published build.
       */
      include: [/\.(vue|[jt]sx?)($|\?)/],
    },
  },
  shortcuts: [
    ['btn', 'px-4 py-1 rounded inline-block bg-primary text-white cursor-pointer hover:bg-primary hover:opacity-90 disabled:cursor-default disabled:bg-gray-600 disabled:opacity-50'],
    ['icon-btn', 'text-[1.3em] inline-block cursor-pointer select-none transition duration-200 ease-in-out hover:opacity-100 hover:text-primary !outline-none'],
    ['flex-center', 'flex items-center justify-center'],
    ['flex-items-center', 'flex items-center'],
    ['flex-justify-center', 'flex justify-center'],
  ],
  theme: {
    colors: {
      primary: '#00A86B',
    },
  },
  presets: [
    presetWind4(),
    presetAttributify({}),
    presetIcons({
      scale: 1.2,
      warn: true,
      collections: {
        creatly: () => import('@creatly/figma-icons/json/icons.json').then(i => i.default),
      },
    }),
    presetWebFonts({
      fonts: {
        sans: 'DM Sans',
        serif: 'DM Serif Display',
        mono: 'DM Mono',
      },
    }),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})
