import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
  presetWebFonts,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
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
    presetUno(),
    presetAttributify({}),
    presetIcons({
      scale: 1.2,
      warn: true,
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
