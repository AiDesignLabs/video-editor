import type { IChromaKey, IMask } from '@video-editor/shared'
import type { Filter } from 'pixi.js'
import { createShaderFilterFromSpec, readFilterUniforms } from './effect-registry'

/** Uniform group name of the shape mask shader. */
export const MASK_UNIFORM_GROUP = 'uMask'
/** Uniform group name of the chroma key shader. */
export const CHROMA_KEY_UNIFORM_GROUP = 'uChromaKey'

/**
 * Structural fingerprint for the mask/chroma stage of a segment.
 *
 * Only the parts that change the *shape of the chain* are included: the mask
 * shape and its inverse flag (they branch in the shader) and whether chroma
 * keying is on at all. Numeric parameters are pushed into live uniforms each
 * frame, so animating them never rebuilds a filter.
 */
export function maskChromaStructuralKey(input: {
  mask?: IMask
  chromaKey?: IChromaKey
}): string {
  const parts: string[] = []
  if (input.chromaKey)
    parts.push('chroma:1')
  if (input.mask)
    parts.push(`mask:${input.mask.shape}:${input.mask.inverse ? 1 : 0}`)
  return parts.join(',')
}

/** Parse `#rrggbb` (with or without the hash) into normalized RGB. */
export function hexToRgb01(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match)
    return [0, 0, 0]
  const value = Number.parseInt(match[1]!, 16)
  return [
    ((value >> 16) & 0xFF) / 255,
    ((value >> 8) & 0xFF) / 255,
    (value & 0xFF) / 255,
  ]
}

export interface MaskUniforms {
  uShape: number
  uCenter: number[]
  uHalfSize: number[]
  uFeather: number
  uRotation: number
  uInverse: number
}

/**
 * Pure uniform computation for the mask shader.
 *
 * The protocol expresses the mask in display-box space: `center` in [-1, 1]
 * with the origin at the box center and +y pointing up, `size` as the full
 * extent relative to the box. Texture coordinates have their origin in the
 * top-left corner with +y pointing down, so the y axis is flipped here:
 * `centerUv = (0.5 + cx * 0.5, 0.5 - cy * 0.5)`.
 *
 * Rotation is applied in normalized box space, i.e. it follows the box aspect
 * ratio rather than being angle-preserving on screen.
 */
export function computeMaskUniforms(mask: IMask): MaskUniforms {
  const [cx, cy] = mask.center
  const [width, height] = mask.size
  return {
    uShape: mask.shape === 'ellipse' ? 1 : 0,
    uCenter: [0.5 + clamp(cx, -1, 1) * 0.5, 0.5 - clamp(cy, -1, 1) * 0.5],
    // Half-extents, floored so a degenerate size cannot divide by zero.
    uHalfSize: [Math.max(clamp(width, 0, 1) * 0.5, 1e-4), Math.max(clamp(height, 0, 1) * 0.5, 1e-4)],
    uFeather: clamp(mask.feather ?? 0, 0, 1),
    uRotation: ((mask.rotation ?? 0) * Math.PI) / 180,
    uInverse: mask.inverse ? 1 : 0,
  }
}

/**
 * Shape mask shader: one fragment covers both shapes through a signed distance
 * field normalized so `d == 1` is the mask edge. `rect` uses the per-axis
 * chebyshev distance, `ellipse` the euclidean length of the same offset.
 */
export const MASK_FRAGMENT = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputClamp;

uniform float uShape;
uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uFeather;
uniform float uRotation;
uniform float uInverse;

void main(void)
{
    vec4 source = texture(uTexture, vTextureCoord);

    vec2 uv = vTextureCoord / max(uInputClamp.zw, vec2(0.0001));
    vec2 offset = uv - uCenter;

    float c = cos(-uRotation);
    float s = sin(-uRotation);
    vec2 rotated = vec2(offset.x * c - offset.y * s, offset.x * s + offset.y * c);

    vec2 normalized = rotated / uHalfSize;
    float rectDist = max(abs(normalized.x), abs(normalized.y));
    float ellipseDist = length(normalized);
    float dist = mix(rectDist, ellipseDist, step(0.5, uShape));

    float inner = 1.0 - uFeather;
    float alpha = 1.0 - smoothstep(inner, max(1.0, inner + 0.0001), dist);
    alpha = mix(alpha, 1.0 - alpha, step(0.5, uInverse));

    // Source is premultiplied, so scaling the whole texel keeps it consistent.
    finalColor = source * alpha;
}
`

/** Build the shape mask filter. */
export function createMaskFilter(): Filter {
  return createShaderFilterFromSpec({
    fragment: MASK_FRAGMENT,
    uniformGroup: MASK_UNIFORM_GROUP,
    uniforms: {
      uShape: { value: 0, type: 'f32' },
      uCenter: { value: [0.5, 0.5], type: 'vec2<f32>' },
      uHalfSize: { value: [0.5, 0.5], type: 'vec2<f32>' },
      uFeather: { value: 0, type: 'f32' },
      uRotation: { value: 0, type: 'f32' },
      uInverse: { value: 0, type: 'f32' },
    },
  })
}

/** Push the current mask values into an existing mask filter. */
export function updateMaskFilter(filter: Filter, mask: IMask): void {
  const bag = readFilterUniforms(filter, MASK_UNIFORM_GROUP)
  if (!bag)
    return
  const uniforms = computeMaskUniforms(mask)
  bag.uShape = uniforms.uShape
  writeVec2(bag, 'uCenter', uniforms.uCenter)
  writeVec2(bag, 'uHalfSize', uniforms.uHalfSize)
  bag.uFeather = uniforms.uFeather
  bag.uRotation = uniforms.uRotation
  bag.uInverse = uniforms.uInverse
}

export interface ChromaKeyUniforms {
  uKeyColor: number[]
  uSimilarity: number
  uSmoothness: number
  uSpillSuppress: number
}

/** Pure uniform computation for the chroma key shader. */
export function computeChromaKeyUniforms(key: IChromaKey): ChromaKeyUniforms {
  return {
    uKeyColor: hexToRgb01(key.color),
    uSimilarity: clamp(key.similarity, 0, 1),
    uSmoothness: clamp(key.smoothness ?? 0, 0, 1),
    uSpillSuppress: clamp(key.spillSuppress ?? 0, 0, 1),
  }
}

/**
 * Chroma key shader. The texel and the key color are converted to BT.601
 * YCbCr and compared on the CbCr plane only, so luminance differences (shadows
 * and folds on a green screen) do not break the key. The distance is scaled by
 * 2 so that `1.0` is roughly the maximum chroma separation, which makes the
 * protocol's `similarity` a 0..1 knob.
 */
export const CHROMA_KEY_FRAGMENT = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpillSuppress;

vec2 toChroma(vec3 color)
{
    float y = dot(color, vec3(0.299, 0.587, 0.114));
    return vec2((color.b - y) * 0.564, (color.r - y) * 0.713);
}

void main(void)
{
    vec4 source = texture(uTexture, vTextureCoord);
    vec3 color = source.a > 0.0 ? source.rgb / source.a : source.rgb;

    float dist = distance(toChroma(color), toChroma(uKeyColor)) * 2.0;
    float alphaMask = smoothstep(uSimilarity, uSimilarity + uSmoothness + 0.0001, dist);

    // Pixels close to the key color keep a green/blue cast; pull them toward
    // their own luma in proportion to how close they were.
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(luma), (1.0 - alphaMask) * uSpillSuppress);

    float alpha = source.a * alphaMask;
    finalColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}
`

/** Build the chroma key filter. */
export function createChromaKeyFilter(): Filter {
  return createShaderFilterFromSpec({
    fragment: CHROMA_KEY_FRAGMENT,
    uniformGroup: CHROMA_KEY_UNIFORM_GROUP,
    uniforms: {
      uKeyColor: { value: [0, 1, 0], type: 'vec3<f32>' },
      uSimilarity: { value: 0, type: 'f32' },
      uSmoothness: { value: 0, type: 'f32' },
      uSpillSuppress: { value: 0, type: 'f32' },
    },
  })
}

/** Push the current chroma key values into an existing chroma key filter. */
export function updateChromaKeyFilter(filter: Filter, key: IChromaKey): void {
  const bag = readFilterUniforms(filter, CHROMA_KEY_UNIFORM_GROUP)
  if (!bag)
    return
  const uniforms = computeChromaKeyUniforms(key)
  writeVec3(bag, 'uKeyColor', uniforms.uKeyColor)
  bag.uSimilarity = uniforms.uSimilarity
  bag.uSmoothness = uniforms.uSmoothness
  bag.uSpillSuppress = uniforms.uSpillSuppress
}

type UniformBag = Record<string, number | number[] | Float32Array>

/** Write into the existing vector storage when possible (pixi reuses buffers). */
function writeVec2(bag: UniformBag, name: string, value: number[]) {
  writeVector(bag, name, value, 2)
}

function writeVec3(bag: UniformBag, name: string, value: number[]) {
  writeVector(bag, name, value, 3)
}

function writeVector(bag: UniformBag, name: string, value: number[], length: number) {
  const current = bag[name]
  if (Array.isArray(current) || current instanceof Float32Array) {
    for (let i = 0; i < length; i++)
      current[i] = value[i] ?? 0
    return
  }
  bag[name] = [...value]
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value))
    return min
  return Math.min(max, Math.max(min, value))
}
