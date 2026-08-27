import type { Filter } from 'pixi.js'
import type { VisualEffectParam } from './types'

/**
 * A registered effect/filter implementation, keyed by the protocol's
 * effectId/filterId. Unknown ids fall back to legacy name matching in
 * pixi-effects.ts, so downstream protocols with arbitrary names keep working.
 */
export interface EffectDefinition {
  id: string
  label: string
  build: (param: VisualEffectParam) => Filter[]
}

const registry = new Map<string, EffectDefinition>()

export function registerEffect(definition: EffectDefinition) {
  registry.set(definition.id, definition)
}

export function getEffectDefinition(param: VisualEffectParam): EffectDefinition | undefined {
  const id = param.segmentType === 'filter' ? param.filterId : param.effectId
  return registry.get(id)
}

export function listEffectDefinitions(): EffectDefinition[] {
  return [...registry.values()]
}
