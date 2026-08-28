import type { BLEND_MODES, Filter } from 'pixi.js'
import type { VisualEffectParam } from './types'
import { defaultFilterVert, Filter as PixiFilter } from 'pixi.js'

/** Per-frame context handed to `EffectDefinition.update`. */
export interface ShaderEffectContext {
  /** Timeline time of the current frame in ms. */
  timeMs: number
  /** Segment source time in ms. */
  sourceTimeMs: number
}

/** A single uniform declaration for the GLSL convenience path. */
export interface EffectUniformDeclaration {
  value: number | number[] | Float32Array
  /** WGSL-style type string, e.g. 'f32', 'vec2<f32>', 'vec4<f32>'. */
  type: string
  /** Array length for array uniforms (mirrors pixi's UniformGroup option). */
  size?: number
}

/** Subset of pixi's FilterOptions exposed to effect authors. */
export interface EffectFilterOptions {
  padding?: number
  resolution?: number | 'inherit'
  antialias?: 'on' | 'off' | 'inherit'
  blendMode?: BLEND_MODES
}

/** Uniform group name used by the GLSL convenience path. */
export const EFFECT_UNIFORM_GROUP = 'uEffect'

/**
 * A registered effect/filter implementation, keyed by the protocol's
 * effectId/filterId. Unknown ids fall back to legacy name matching in
 * pixi-effects.ts, so downstream protocols with arbitrary names keep working.
 *
 * Two authoring paths:
 * - convenience: provide `fragment` (plus optional `uniforms`) and the registry
 *   builds a WebGL-only `Filter` for you.
 * - escape hatch: provide `build` and allocate the filters yourself.
 */
export interface EffectDefinition {
  id: string
  label: string
  /** Convenience path: GLSL fragment (samples `uTexture` at `vTextureCoord`). */
  fragment?: string
  /** Optional custom vertex shader; defaults to pixi's `defaultFilterVert`. */
  vertex?: string
  /** Initial uniform declarations for the convenience path (group `uEffect`). */
  uniforms?: Record<string, EffectUniformDeclaration>
  filterOptions?: EffectFilterOptions
  /** Escape hatch; MUST return freshly allocated Filter instances. Defaults to building from `fragment`. */
  build?: (param: VisualEffectParam) => Filter[]
  /** Cache key for structural identity; animated params MUST NOT be included. Defaults to the id. */
  structuralKey?: (param: VisualEffectParam) => string
  /** Per-frame parameter update; called every frame without rebuilding. */
  update?: (filters: Filter[], param: VisualEffectParam, ctx: ShaderEffectContext) => void
  /** Optional custom teardown; defaults to `filter.destroy()` per filter. */
  dispose?: (filters: Filter[]) => void
}

const registry = new Map<string, EffectDefinition>()

export function registerEffect(definition: EffectDefinition) {
  if (!definition.fragment && !definition.build)
    throw new Error(`[renderer] effect "${definition.id}" must provide either a GLSL "fragment" or a "build" function`)
  registry.set(definition.id, definition)
}

export function unregisterEffect(id: string): boolean {
  return registry.delete(id)
}

export function getEffectDefinition(param: VisualEffectParam): EffectDefinition | undefined {
  const id = param.segmentType === 'filter' ? param.filterId : param.effectId
  return registry.get(id)
}

export function listEffectDefinitions(): EffectDefinition[] {
  return [...registry.values()]
}

/** Structural identity of an effect instance: stable across animated params. */
export function structuralKeyForEffect(definition: EffectDefinition, param: VisualEffectParam): string {
  return definition.structuralKey ? definition.structuralKey(param) : definition.id
}

/** Build the filter instances for one effect occurrence. */
export function buildEffectFilters(definition: EffectDefinition, param: VisualEffectParam): Filter[] {
  if (definition.build)
    return definition.build(param)
  return [createShaderFilter(definition)]
}

/**
 * Build a WebGL-only filter from a definition's GLSL fragment.
 *
 * `GlProgram.from` caches compilation by source, so N instances of one shader
 * compile once. Never call `destroy(true)` on these filters: that would drop
 * the shared program from the cache.
 */
export function createShaderFilter(definition: EffectDefinition): Filter {
  if (!definition.fragment)
    throw new Error(`[renderer] effect "${definition.id}" has no GLSL fragment to build from`)

  const resources = definition.uniforms
    ? { [EFFECT_UNIFORM_GROUP]: cloneUniforms(definition.uniforms) }
    : {}

  return PixiFilter.from({
    ...definition.filterOptions,
    gl: {
      vertex: definition.vertex ?? defaultFilterVert,
      fragment: definition.fragment,
    },
    resources,
  })
}

/** Deep-copy uniform declarations so a definition can back many instances. */
function cloneUniforms(uniforms: Record<string, EffectUniformDeclaration>): Record<string, EffectUniformDeclaration> {
  const out: Record<string, EffectUniformDeclaration> = {}
  for (const [name, declaration] of Object.entries(uniforms)) {
    const { value } = declaration
    out[name] = {
      ...declaration,
      value: Array.isArray(value)
        ? [...value]
        : value instanceof Float32Array
          ? new Float32Array(value)
          : value,
    }
  }
  return out
}

/**
 * Read a filter's uniform bag for a group, tolerating filters that were built
 * outside the convenience path (or test doubles without resources).
 */
export function readFilterUniforms(filter: Filter, group = EFFECT_UNIFORM_GROUP): Record<string, number | number[] | Float32Array> | undefined {
  const resources = (filter as Filter & { resources?: Record<string, unknown> }).resources
  const bag = resources?.[group] as { uniforms?: Record<string, number | number[] | Float32Array> } | undefined
  return bag?.uniforms
}
