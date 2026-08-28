import type { TransitionDefinition } from './transition-registry'
import { registerTransition } from './transition-registry'

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

const HEADER = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

uniform float uProgress;
uniform float uRole;
`

/** Normalized 0..1 frame coordinates from the (padded) filter texture coord. */
const FRAME_UV = `
vec2 frameSize()
{
    return max(uInputClamp.zw, vec2(0.0001));
}

vec2 frameUv()
{
    return vTextureCoord / frameSize();
}

bool outsideFrame(vec2 coord)
{
    return coord.x < uInputClamp.x || coord.y < uInputClamp.y
        || coord.x > uInputClamp.z || coord.y > uInputClamp.w;
}
`

const CROSSFADE_FRAGMENT = `${HEADER}
void main(void)
{
    vec4 texel = texture(uTexture, vTextureCoord);
    // Premultiplied alpha: one multiply fades colour and alpha together.
    float amount = mix(1.0 - uProgress, uProgress, uRole);
    finalColor = texel * amount;
}
`

const WIPE_FRAGMENT = `${HEADER}
uniform vec2 uDirection;
${FRAME_UV}
const float FEATHER = 0.03;

void main(void)
{
    vec4 texel = texture(uTexture, vTextureCoord);
    if (uRole < 0.5) {
        finalColor = texel;
        return;
    }

    // Project onto the wipe axis; always 0..1 whichever way uDirection points.
    float axis = dot(frameUv() - 0.5, uDirection) + 0.5;
    float edge = mix(-FEATHER, 1.0 + FEATHER, uProgress);
    float revealed = 1.0 - smoothstep(edge - FEATHER, edge + FEATHER, axis);
    finalColor = texel * revealed;
}
`

const CIRCLE_FRAGMENT = `${HEADER}
${FRAME_UV}
void main(void)
{
    vec4 texel = texture(uTexture, vTextureCoord);
    if (uRole < 0.5) {
        finalColor = texel;
        return;
    }

    // Aspect-correct the distance so the reveal stays a circle, not an ellipse.
    float aspect = max(uInputSize.x, 1.0) / max(uInputSize.y, 1.0);
    vec2 offset = (frameUv() - 0.5) * vec2(aspect, 1.0);
    float dist = length(offset);
    float maxRadius = length(vec2(aspect, 1.0) * 0.5);
    float feather = maxRadius * 0.03;
    float radius = mix(-feather, maxRadius + feather, uProgress);
    finalColor = texel * (1.0 - smoothstep(radius - feather, radius + feather, dist));
}
`

const SLIDE_FRAGMENT = `${HEADER}
uniform vec2 uDirection;
${FRAME_UV}
void main(void)
{
    if (uRole < 0.5) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    // Sample from an offset that shrinks to zero as the incoming clip settles.
    vec2 coord = vTextureCoord - uDirection * (1.0 - uProgress) * frameSize();
    if (outsideFrame(coord)) {
        finalColor = vec4(0.0);
        return;
    }
    finalColor = texture(uTexture, coord);
}
`

const FLASH_FRAGMENT = `${HEADER}
uniform vec4 uFlashColor;

vec3 unpremultiply(vec4 c)
{
    return c.a > 0.0 ? c.rgb / c.a : c.rgb;
}

void main(void)
{
    vec4 texel = texture(uTexture, vTextureCoord);
    // Peaks at the midpoint, where the two sides swap over.
    float mixFactor = 1.0 - abs(2.0 * uProgress - 1.0);
    float past = step(0.5, uProgress);
    float visible = mix(1.0 - past, past, uRole);

    vec3 color = mix(unpremultiply(texel), uFlashColor.rgb, mixFactor);
    float alpha = texel.a * visible;
    finalColor = vec4(color * alpha, alpha);
}
`

const ZOOM_FRAGMENT = `${HEADER}
${FRAME_UV}
void main(void)
{
    if (uRole < 0.5) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    // Scale 1.5 -> 1 around the frame centre while fading in.
    float scale = mix(1.5, 1.0, uProgress);
    vec2 uv = (frameUv() - 0.5) / scale + 0.5;
    vec2 coord = uv * frameSize();
    if (outsideFrame(coord)) {
        finalColor = vec4(0.0);
        return;
    }
    finalColor = texture(uTexture, coord) * uProgress;
}
`

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
]

for (const definition of BUILT_IN_TRANSITIONS)
  registerTransition(definition)
