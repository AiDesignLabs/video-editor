import type { EffectDefinition } from './effect-registry'
import type { TransitionDefinition } from './transition-registry'

export type LocalizedDefinition = Pick<EffectDefinition | TransitionDefinition, 'id' | 'label' | 'labelKey' | 'labels'>

/** Resolve a renderer label while leaving final product copy under host control. */
export function resolveDefinitionLabel(definition: LocalizedDefinition, locale = 'en'): string {
  const labels = definition.labels
  if (labels) {
    const exact = labels[locale]
    if (exact)
      return exact
    const language = locale.split('-')[0]
    if (labels[language])
      return labels[language]
  }
  return definition.label
}

export function definitionLabelKey(definition: LocalizedDefinition): string {
  return definition.labelKey ?? definition.id
}
