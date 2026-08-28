import type { Filter } from 'pixi.js'
import type { EffectFilterOptions, EffectUniformDeclaration } from './effect-registry'
import { createShaderFilterFromSpec, readFilterUniforms } from './effect-registry'

/** Which side of the transition a display is being rendered as. */
export type TransitionRole = 'from' | 'to'

/** Per-frame context handed to `TransitionDefinition.update`. */
export interface TransitionRenderContext {
  /** Timeline time of the current frame in ms. */
  timeMs: number
  /** Transition progress, 0 at the start and 1 at the end. */
  progress: number
  /** Whether this display is the outgoing (`from`) or incoming (`to`) side. */
  role: TransitionRole
}

/**
 * A registered transition implementation. Resolution happens by protocol
 * transition id first, then case-insensitively by the protocol transition name
 * (older protocols only carry a meaningful name).
 *
 * Two authoring paths, mirroring `EffectDefinition`:
 * - convenience: provide `fragment` (plus optional `uniforms`) and the registry
 *   builds a WebGL-only `Filter` bound to the `uTransition` uniform group. The
 *   group always carries `uProgress` (0..1) and `uRole` (0 = from, 1 = to).
 * - escape hatch: provide `build`/`update` and allocate the filters yourself.
 */
export interface TransitionDefinition {
  id: string
  label: string
  /**
   * Convenience path: GLSL fragment applied per display. MUST start with
   * `precision highp float;` — pixi's default filter vertex shader declares
   * `uInputSize` and friends as highp, and a mismatched fragment precision
   * makes the program fail to link at runtime (silently blanking the display).
   */
  fragment?: string
  /** Optional custom vertex shader; defaults to pixi's `defaultFilterVert`. */
  vertex?: string
  /** Extra uniform declarations, merged over the built-in uProgress/uRole. */
  uniforms?: Record<string, EffectUniformDeclaration>
  filterOptions?: EffectFilterOptions
  /** Escape hatch; MUST return freshly allocated Filter instances. */
  build?: (role: TransitionRole) => Filter[]
  /** Per-frame update; called every frame without rebuilding. */
  update?: (filters: Filter[], ctx: TransitionRenderContext) => void
  /** Optional custom teardown; defaults to `filter.destroy()` per filter. */
  dispose?: (filters: Filter[]) => void
}

/** Uniform group name used by the transition GLSL convenience path. */
export const TRANSITION_UNIFORM_GROUP = 'uTransition'

const registry = new Map<string, TransitionDefinition>()

export function registerTransition(definition: TransitionDefinition) {
  if (!definition.fragment && !definition.build)
    throw new Error(`[renderer] transition "${definition.id}" must provide either a GLSL "fragment" or a "build" function`)
  registry.set(definition.id, definition)
}

export function unregisterTransition(id: string): boolean {
  return registry.delete(id)
}

/**
 * Resolve a transition definition. Exact id match wins; otherwise the key is
 * matched case-insensitively against every definition's id and label.
 */
export function getTransitionDefinition(idOrName: string | undefined | null): TransitionDefinition | undefined {
  if (typeof idOrName !== 'string')
    return undefined
  const key = idOrName.trim()
  if (!key)
    return undefined

  const exact = registry.get(key)
  if (exact)
    return exact

  const lowered = key.toLowerCase()
  for (const definition of registry.values()) {
    if (definition.id.toLowerCase() === lowered || definition.label.toLowerCase() === lowered)
      return definition
  }
  return undefined
}

export function listTransitionDefinitions(): TransitionDefinition[] {
  return [...registry.values()]
}

/** Structural identity of a transition occurrence: id plus the rendered role. */
export function transitionStructuralKey(definition: TransitionDefinition, role: TransitionRole): string {
  return `transition:${definition.id}:${role}`
}

/** Build the filter instances for one transition occurrence. */
export function buildTransitionFilters(definition: TransitionDefinition, role: TransitionRole): Filter[] {
  if (definition.build)
    return definition.build(role)
  if (!definition.fragment)
    throw new Error(`[renderer] transition "${definition.id}" has no GLSL fragment to build from`)

  return [createShaderFilterFromSpec({
    fragment: definition.fragment,
    vertex: definition.vertex,
    uniformGroup: TRANSITION_UNIFORM_GROUP,
    uniforms: {
      uProgress: { value: 0, type: 'f32' },
      uRole: { value: role === 'to' ? 1 : 0, type: 'f32' },
      ...definition.uniforms,
    },
    filterOptions: definition.filterOptions,
  })]
}

/**
 * Push the per-frame transition state into live filters. An author-supplied
 * `update` replaces the default entirely.
 */
export function updateTransitionFilters(
  definition: TransitionDefinition,
  filters: Filter[],
  ctx: TransitionRenderContext,
): void {
  if (definition.update) {
    definition.update(filters, ctx)
    return
  }
  const progress = clamp01(ctx.progress)
  const role = ctx.role === 'to' ? 1 : 0
  for (const filter of filters) {
    const bag = readFilterUniforms(filter, TRANSITION_UNIFORM_GROUP)
    if (!bag)
      continue
    bag.uProgress = progress
    bag.uRole = role
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value))
    return 0
  return Math.min(Math.max(value, 0), 1)
}
