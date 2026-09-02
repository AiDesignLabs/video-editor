import type { SegmentUnion } from '@video-editor/shared'
import type {
  BatchResult,
  EditorCoreCommands,
  EditorCoreSelectors,
  MoveSegmentOptions,
  RemoveSegmentOptions,
} from './types'

/** All a batch needs to know about an existing segment: which one, and where. */
interface SegmentSummary {
  id: string
  startTime: number
}

/**
 * The single commands a batch is built from. Taken as a parameter rather than
 * read off the finished command object so this module cannot accidentally reach
 * for anything else.
 */
interface BatchDeps {
  transaction: EditorCoreCommands['transaction']
  moveSegment: EditorCoreCommands['moveSegment']
  removeSegment: EditorCoreCommands['removeSegment']
  duplicateSegment: EditorCoreCommands['duplicateSegment']
  updateSegment: EditorCoreCommands['updateSegment']
  getSegment: EditorCoreSelectors['getSegment']
}

function ok(segmentIds: string[]): BatchResult {
  return { success: true, segmentIds }
}

function rejected(error: string): BatchResult {
  return { success: false, error, segmentIds: [] }
}

/** Keeps the first occurrence of each id so a caller's selection order survives. */
function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

export function createBatchCommands(deps: BatchDeps) {
  const { transaction, getSegment } = deps

  /**
   * Runs `body` as one undo step. `body` returns the ids it touched, or an
   * error string to reject the whole batch — a batch is all-or-nothing, so a
   * rejection rolls back everything done so far and leaves history untouched.
   */
  function batch(label: string, data: Record<string, unknown>, body: () => string[] | string): BatchResult {
    let outcome: BatchResult = rejected(`${label}: nothing ran`)
    transaction((tx) => {
      const result = body()
      if (typeof result === 'string') {
        outcome = rejected(result)
        tx.cancel()
        return
      }
      outcome = ok(result)
    }, { label, data })
    return outcome
  }

  function requireSegments(ids: readonly string[], label: string): SegmentSummary[] | string {
    const segments: SegmentSummary[] = []
    for (const id of ids) {
      const segment = getSegment(id)
      if (!segment)
        return `${label}: no segment with id ${id}`
      segments.push({ id: segment.id, startTime: segment.startTime })
    }
    return segments
  }

  return {
    moveSegments(moves: readonly MoveSegmentOptions[]): BatchResult {
      if (!moves.length)
        return ok([])

      return batch('move-segments', { moves: moves.map(move => ({ ...move })) }, () => {
        const moved: string[] = []
        for (const move of moves) {
          if (!deps.moveSegment(move).success)
            return `move-segments: could not move ${move.segmentId}`
          moved.push(move.segmentId)
        }
        return moved
      })
    },

    removeSegments(ids: readonly string[], options?: RemoveSegmentOptions): BatchResult {
      const targets = unique(ids)
      if (!targets.length)
        return ok([])

      return batch('remove-segments', { segmentIds: targets, ripple: options?.ripple === true }, () => {
        const segments = requireSegments(targets, 'remove-segments')
        if (typeof segments === 'string')
          return segments

        // Latest first: removing a segment can ripple the ones after it left,
        // which would move targets we have not reached yet.
        const ordered = segments
          .map((segment, index) => ({ segment, index }))
          .sort((a, b) => b.segment.startTime - a.segment.startTime || b.index - a.index)

        for (const { segment } of ordered) {
          if (!deps.removeSegment(segment.id, options).success)
            return `remove-segments: could not remove ${segment.id}`
        }
        return targets
      })
    },

    updateSegments(ids: readonly string[], updater: (segment: SegmentUnion) => void): BatchResult {
      const targets = unique(ids)
      if (!targets.length)
        return ok([])

      return batch('update-segments', { segmentIds: targets }, () => {
        const segments = requireSegments(targets, 'update-segments')
        if (typeof segments === 'string')
          return segments

        for (const id of targets) {
          // A rejected edit leaves no trace of its own, so without this the
          // batch would report success while one segment silently kept its
          // old value.
          if (!deps.updateSegment(updater, id))
            return `update-segments: rejected the edit to ${id}`
        }
        return targets
      })
    },

    duplicateSegments(ids: readonly string[]): BatchResult {
      const targets = unique(ids)
      if (!targets.length)
        return ok([])

      return batch('duplicate-segments', { segmentIds: targets }, () => {
        const segments = requireSegments(targets, 'duplicate-segments')
        if (typeof segments === 'string')
          return segments

        const created: string[] = []
        for (const id of targets) {
          const result = deps.duplicateSegment(id)
          if (!result.success)
            return `duplicate-segments: could not duplicate ${id}`
          created.push(result.id)
        }
        // The new ids, not the sources: they are what a caller selects next.
        return created
      })
    },
  }
}
