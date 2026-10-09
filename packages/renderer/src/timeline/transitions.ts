import type { TransitionDefinition } from './transition-registry'
import { CUSTOM_TRANSITION_SHADERS } from './shaders/catalog'

import { registerTransition } from './transition-registry'

const { ANGULAR_FRAGMENT, BLINDS_FRAGMENT, CIRCLE_FRAGMENT, COLOR_PHASE_FRAGMENT, CROSSFADE_FRAGMENT, DIAMOND_FRAGMENT, DISSOLVE_FRAGMENT, DOORWAY_FRAGMENT, FADE_GRAYSCALE_FRAGMENT, FLASH_FRAGMENT, RADIAL_FRAGMENT, ROTATE_SCALE_FRAGMENT, SLIDE_FRAGMENT, SPLIT_FRAGMENT, WIPE_FRAGMENT, ZOOM_FRAGMENT } = CUSTOM_TRANSITION_SHADERS

/**
 * Built-in shader transitions.
 *
 * Every fragment MUST start with `precision highp float;`: pixi's default
 * filter vertex shader declares `uInputSize`/`uInputClamp` as highp, and a
 * precision mismatch makes the program fail to link at runtime.
 *
 * Filters output premultiplied alpha, so "hide this pixel" is `vec4(0.0)` and
 * a uniform fade is a plain multiply of the whole premultiplied texel.
 *
 * Convention: the `to` display is drawn on top of the `from` display, so most
 * reveal-style transitions only need to mask the `to` side and let `from` pass
 * through unchanged.
 */

/** Normalized 0..1 frame coordinates from the (padded) filter texture coord. */

// The following transition shapes are adapted from the MIT-licensed
// gl-transitions catalogue. They are rewritten for this renderer's
// two-display model: the outgoing display stays intact while the incoming
// display is revealed or transformed by the shader.

function wipe(id: string, label: string, direction: [number, number]): TransitionDefinition {
  return {
    id,
    label,
    fragment: WIPE_FRAGMENT,
    uniforms: { uDirection: { value: [...direction], type: 'vec2<f32>' } },
  }
}

function slide(id: string, label: string, direction: [number, number]): TransitionDefinition {
  return {
    id,
    label,
    fragment: SLIDE_FRAGMENT,
    uniforms: { uDirection: { value: [...direction], type: 'vec2<f32>' } },
  }
}

function flash(id: string, label: string, color: [number, number, number]): TransitionDefinition {
  return {
    id,
    label,
    fragment: FLASH_FRAGMENT,
    uniforms: { uFlashColor: { value: [...color, 1], type: 'vec4<f32>' } },
  }
}

function blinds(id: string, label: string, count: number): TransitionDefinition {
  return {
    id,
    label,
    fragment: BLINDS_FRAGMENT,
    uniforms: { uCount: { value: count, type: 'f32' } },
  }
}

function angular(id: string, label: string, startingAngle: number): TransitionDefinition {
  return {
    id,
    label,
    fragment: ANGULAR_FRAGMENT,
    uniforms: { uStartingAngle: { value: startingAngle, type: 'f32' } },
  }
}

/**
 * Built-in transition definitions, in the order they should be offered in a
 * picker. `crossfade` is the default.
 */
export const BUILT_IN_TRANSITIONS: TransitionDefinition[] = [
  { id: 'crossfade', label: 'Crossfade', fragment: CROSSFADE_FRAGMENT },
  // Direction points the way the wipe edge travels across the frame.
  wipe('wipe-left', 'Wipe Left', [-1, 0]),
  wipe('wipe-right', 'Wipe Right', [1, 0]),
  wipe('wipe-up', 'Wipe Up', [0, -1]),
  wipe('wipe-down', 'Wipe Down', [0, 1]),
  { id: 'circle', label: 'Circle', fragment: CIRCLE_FRAGMENT },
  // Direction points the way the incoming clip travels.
  slide('slide-left', 'Slide Left', [1, 0]),
  slide('slide-right', 'Slide Right', [-1, 0]),
  flash('flash-black', 'Flash Black', [0, 0, 0]),
  flash('flash-white', 'Flash White', [1, 1, 1]),
  { id: 'zoom', label: 'Zoom', fragment: ZOOM_FRAGMENT },
  { id: 'radial', label: 'Radial', fragment: RADIAL_FRAGMENT },
  { id: 'diamond', label: 'Diamond', fragment: DIAMOND_FRAGMENT },
  blinds('blinds-vertical', 'Blinds Vertical', 8),
  blinds('blinds-fine', 'Fine Blinds', 14),
  { id: 'dissolve', label: 'Dissolve', fragment: DISSOLVE_FRAGMENT },
  { id: 'split', label: 'Split', fragment: SPLIT_FRAGMENT },
  angular('angular', 'Angular', 90),
  { id: 'fade-grayscale', label: 'Fade Grayscale', fragment: FADE_GRAYSCALE_FRAGMENT },
  { id: 'doorway', label: 'Doorway', fragment: DOORWAY_FRAGMENT },
  { id: 'rotate-scale', label: 'Rotate Scale', fragment: ROTATE_SCALE_FRAGMENT },
  { id: 'color-phase', label: 'Color Phase', fragment: COLOR_PHASE_FRAGMENT },
]

for (const definition of BUILT_IN_TRANSITIONS)
  registerTransition(definition)
