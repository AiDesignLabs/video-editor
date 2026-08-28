import type { IPalette } from '@video-editor/shared'
import type { ColorMatrixFilter, Filter } from 'pixi.js'
import type { EffectDefinition, ShaderEffectContext } from './effect-registry'
import type { TransitionDefinition, TransitionRole } from './transition-registry'
import type { VisualEffectParam } from './types'
import { buildEffectFilters, structuralKeyForEffect } from './effect-registry'
import {
  createPalettePostFilter,
  paletteNeedsPostShader,
  paletteStructuralKey,
  paletteToColorMatrix,
  updatePaletteColorMatrixFilter,
  updatePalettePostFilter,
} from './palette-filter'
import { resolveEffectDefinition } from './pixi-effects'
import {
  buildTransitionFilters,
  getTransitionDefinition,
  transitionStructuralKey,
  updateTransitionFilters,
} from './transition-registry'

/** Transition state for one segment occurrence in the current frame. */
export interface SegmentTransitionInput {
  role: TransitionRole
  progress: number
  transitionId?: string
  transitionName?: string
}

interface BuiltEffect {
  definition: EffectDefinition | undefined
  param: VisualEffectParam
  filters: Filter[]
}

export interface SegmentFilterEntry {
  /** Identity of the filter *chain*; animated params are deliberately excluded. */
  structuralKey: string
  built: BuiltEffect[]
  paletteMatrixFilter?: ColorMatrixFilter
  palettePostFilter?: Filter
  transitionDefinition?: TransitionDefinition
  transitionRole?: TransitionRole
  transitionFilters?: Filter[]
  /** Flattened chain in application order; the array identity is stable. */
  filters: Filter[]
}

export interface SegmentFilterCacheDeps {
  resolveDefinition?: (param: VisualEffectParam) => EffectDefinition | undefined
  buildFilters?: (definition: EffectDefinition, param: VisualEffectParam) => Filter[]
  createPaletteMatrixFilter?: (palette: IPalette) => ColorMatrixFilter | null
  createPalettePost?: (palette: IPalette) => Filter | null
  resolveTransition?: (transition: SegmentTransitionInput) => TransitionDefinition | undefined
  buildTransition?: (definition: TransitionDefinition, role: TransitionRole) => Filter[]
}

export interface SegmentFilterCache {
  /**
   * Return the filter chain for a segment. Rebuilds only when the structural
   * key changes; otherwise runs a per-frame update pass in place.
   */
  resolve: (
    segmentId: string,
    effects: VisualEffectParam[] | undefined,
    palette: IPalette | undefined,
    ctx: ShaderEffectContext,
    transition?: SegmentTransitionInput,
  ) => Filter[]
  /** Drop (and dispose) entries whose segment is no longer on screen. */
  evictInactive: (activeIds: Set<string>) => void
  clear: () => void
  peek: (segmentId: string) => SegmentFilterEntry | undefined
  readonly size: number
}

const KEY_SEPARATOR = '\u0001'

export function createSegmentFilterCache(deps: SegmentFilterCacheDeps = {}): SegmentFilterCache {
  const resolveDefinition = deps.resolveDefinition ?? resolveEffectDefinition
  const buildFilters = deps.buildFilters ?? buildEffectFilters
  const createPaletteMatrixFilter = deps.createPaletteMatrixFilter ?? paletteToColorMatrix
  const createPalettePost = deps.createPalettePost
    ?? ((palette: IPalette) => (paletteNeedsPostShader(palette) ? createPalettePostFilter(palette) : null))
  const resolveTransition = deps.resolveTransition ?? defaultResolveTransition
  const buildTransition = deps.buildTransition ?? buildTransitionFilters

  const entries = new Map<string, SegmentFilterEntry>()
  // Only filters this cache allocated may be destroyed by it.
  const owned = new WeakSet<Filter>()

  function computeStructuralKey(
    effects: VisualEffectParam[] | undefined,
    palette: IPalette | undefined,
    transitionDefinition: TransitionDefinition | undefined,
    transitionRole: TransitionRole | undefined,
  ): string {
    const parts: string[] = []
    for (const effect of effects ?? []) {
      const definition = resolveDefinition(effect)
      parts.push(definition ? structuralKeyForEffect(definition, effect) : '')
    }
    // A segment can be the `from` side one frame and the `to` side later, so
    // the role is part of the structural identity.
    const transitionKey = transitionDefinition && transitionRole
      ? transitionStructuralKey(transitionDefinition, transitionRole)
      : ''
    return `${parts.join(KEY_SEPARATOR)}|${paletteStructuralKey(palette)}|${transitionKey}`
  }

  function build(
    structuralKey: string,
    effects: VisualEffectParam[] | undefined,
    palette: IPalette | undefined,
    transitionDefinition: TransitionDefinition | undefined,
    transitionRole: TransitionRole | undefined,
  ): SegmentFilterEntry {
    // One built record per effect (even when it produces no filters) so the
    // per-frame update pass can pair records with plan effects by index.
    const built: BuiltEffect[] = (effects ?? []).map((param) => {
      const definition = resolveDefinition(param)
      const filters = definition ? buildFilters(definition, param) : []
      for (const filter of filters)
        owned.add(filter)
      return { definition, param, filters }
    })

    const entry: SegmentFilterEntry = { structuralKey, built, filters: [] }

    if (palette) {
      const matrixFilter = createPaletteMatrixFilter(palette)
      if (matrixFilter) {
        owned.add(matrixFilter)
        entry.paletteMatrixFilter = matrixFilter
      }
      const postFilter = createPalettePost(palette)
      if (postFilter) {
        owned.add(postFilter)
        entry.palettePostFilter = postFilter
      }
    }

    if (transitionDefinition && transitionRole) {
      const transitionFilters = buildTransition(transitionDefinition, transitionRole)
      for (const filter of transitionFilters)
        owned.add(filter)
      entry.transitionDefinition = transitionDefinition
      entry.transitionRole = transitionRole
      entry.transitionFilters = transitionFilters
    }

    for (const record of built)
      entry.filters.push(...record.filters)
    if (entry.paletteMatrixFilter)
      entry.filters.push(entry.paletteMatrixFilter)
    if (entry.palettePostFilter)
      entry.filters.push(entry.palettePostFilter)
    // Transition filters run last: they blend the fully-graded segment.
    if (entry.transitionFilters)
      entry.filters.push(...entry.transitionFilters)

    return entry
  }

  function update(
    entry: SegmentFilterEntry,
    effects: VisualEffectParam[] | undefined,
    palette: IPalette | undefined,
    ctx: ShaderEffectContext,
    transition: SegmentTransitionInput | undefined,
  ) {
    const list = effects ?? []
    for (let i = 0; i < entry.built.length; i++) {
      const record = entry.built[i]!
      const param = list[i]
      if (param)
        record.param = param
      record.definition?.update?.(record.filters, record.param, ctx)
    }
    if (palette) {
      if (entry.paletteMatrixFilter)
        updatePaletteColorMatrixFilter(entry.paletteMatrixFilter, palette)
      if (entry.palettePostFilter)
        updatePalettePostFilter(entry.palettePostFilter, palette, ctx.timeMs / 1000)
    }
    if (entry.transitionDefinition && entry.transitionFilters && entry.transitionRole && transition) {
      updateTransitionFilters(entry.transitionDefinition, entry.transitionFilters, {
        timeMs: ctx.timeMs,
        progress: transition.progress,
        role: entry.transitionRole,
      })
    }
  }

  function dispose(entry: SegmentFilterEntry) {
    for (const record of entry.built) {
      if (record.definition?.dispose) {
        record.definition.dispose(record.filters)
        continue
      }
      for (const filter of record.filters)
        destroyOwned(filter)
    }
    if (entry.paletteMatrixFilter)
      destroyOwned(entry.paletteMatrixFilter)
    if (entry.palettePostFilter)
      destroyOwned(entry.palettePostFilter)
    if (entry.transitionFilters) {
      if (entry.transitionDefinition?.dispose) {
        entry.transitionDefinition.dispose(entry.transitionFilters)
      }
      else {
        for (const filter of entry.transitionFilters)
          destroyOwned(filter)
      }
    }
  }

  function destroyOwned(filter: Filter) {
    if (!owned.has(filter))
      return
    owned.delete(filter)
    // Never pass `true`: GlProgram.from caches programs by source globally.
    filter.destroy()
  }

  return {
    resolve(segmentId, effects, palette, ctx, transition) {
      const transitionDefinition = transition ? resolveTransition(transition) : undefined
      const transitionRole = transitionDefinition ? transition?.role : undefined
      const structuralKey = computeStructuralKey(effects, palette, transitionDefinition, transitionRole)
      let entry = entries.get(segmentId)
      if (!entry || entry.structuralKey !== structuralKey) {
        if (entry)
          dispose(entry)
        entry = build(structuralKey, effects, palette, transitionDefinition, transitionRole)
        entries.set(segmentId, entry)
      }
      update(entry, effects, palette, ctx, transition)
      return entry.filters
    },
    evictInactive(activeIds) {
      for (const [id, entry] of entries) {
        if (activeIds.has(id))
          continue
        dispose(entry)
        entries.delete(id)
      }
    },
    clear() {
      for (const entry of entries.values())
        dispose(entry)
      entries.clear()
    },
    peek(segmentId) {
      return entries.get(segmentId)
    },
    get size() {
      return entries.size
    },
  }
}

/** Registry lookup: protocol transition id first, then case-insensitive name. */
function defaultResolveTransition(transition: SegmentTransitionInput): TransitionDefinition | undefined {
  return getTransitionDefinition(transition.transitionId)
    ?? getTransitionDefinition(transition.transitionName)
}
