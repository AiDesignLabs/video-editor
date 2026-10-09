import CHROMATIC from './effects/chromatic.frag?raw'
import DUOTONE from './effects/duotone.frag?raw'
import GLITCH from './effects/glitch.frag?raw'
import GLOW from './effects/glow.frag?raw'
import GRAIN from './effects/grain.frag?raw'
import JITTER from './effects/jitter.frag?raw'
import LIGHT_LEAK from './effects/light-leak.frag?raw'
import PIXELATE_PULSE from './effects/pixelate-pulse.frag?raw'
import PIXELATE from './effects/pixelate.frag?raw'
import POSTERIZE from './effects/posterize.frag?raw'
import PULSE_BLUR from './effects/pulse-blur.frag?raw'
import PULSE_GLOW from './effects/pulse-glow.frag?raw'
import RGB_SPLIT from './effects/rgb-split.frag?raw'
import SCANLINES from './effects/scanlines.frag?raw'
import SHARPEN from './effects/sharpen.frag?raw'
import VIGNETTE from './effects/vignette.frag?raw'
import ANGULAR_FRAGMENT from './transitions/angular-fragment.frag?raw'
import BLINDS_FRAGMENT from './transitions/blinds-fragment.frag?raw'
import CIRCLE_FRAGMENT from './transitions/circle-fragment.frag?raw'
import COLOR_PHASE_FRAGMENT from './transitions/color-phase-fragment.frag?raw'
import CROSSFADE_FRAGMENT from './transitions/crossfade-fragment.frag?raw'
import DIAMOND_FRAGMENT from './transitions/diamond-fragment.frag?raw'
import DISSOLVE_FRAGMENT from './transitions/dissolve-fragment.frag?raw'
import DOORWAY_FRAGMENT from './transitions/doorway-fragment.frag?raw'
import FADE_GRAYSCALE_FRAGMENT from './transitions/fade-grayscale-fragment.frag?raw'
import FLASH_FRAGMENT from './transitions/flash-fragment.frag?raw'
import RADIAL_FRAGMENT from './transitions/radial-fragment.frag?raw'
import ROTATE_SCALE_FRAGMENT from './transitions/rotate-scale-fragment.frag?raw'
import SLIDE_FRAGMENT from './transitions/slide-fragment.frag?raw'
import SPLIT_FRAGMENT from './transitions/split-fragment.frag?raw'
import WIPE_FRAGMENT from './transitions/wipe-fragment.frag?raw'
import ZOOM_FRAGMENT from './transitions/zoom-fragment.frag?raw'

export const CUSTOM_EFFECT_SHADERS = {
  CHROMATIC,
  DUOTONE,
  GLITCH,
  GLOW,
  GRAIN,
  JITTER,
  LIGHT_LEAK,
  PIXELATE,
  PIXELATE_PULSE,
  POSTERIZE,
  PULSE_BLUR,
  PULSE_GLOW,
  RGB_SPLIT,
  SCANLINES,
  SHARPEN,
  VIGNETTE,
} as const

export const CUSTOM_TRANSITION_SHADERS = {
  ANGULAR_FRAGMENT,
  BLINDS_FRAGMENT,
  CIRCLE_FRAGMENT,
  COLOR_PHASE_FRAGMENT,
  CROSSFADE_FRAGMENT,
  DIAMOND_FRAGMENT,
  DISSOLVE_FRAGMENT,
  DOORWAY_FRAGMENT,
  FADE_GRAYSCALE_FRAGMENT,
  FLASH_FRAGMENT,
  RADIAL_FRAGMENT,
  ROTATE_SCALE_FRAGMENT,
  SLIDE_FRAGMENT,
  SPLIT_FRAGMENT,
  WIPE_FRAGMENT,
  ZOOM_FRAGMENT,
} as const
