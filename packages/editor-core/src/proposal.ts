import type { IVideoProtocol, SegmentUnion, TrackUnion } from '@video-editor/shared'
import type {
  EditorCore,
  EditorProposal,
  EditorProposalManager,
  ProposalActionResult,
  ProposalChangeSummary,
} from './types'

interface ProposalManagerDependencies {
  getProtocol: () => IVideoProtocol
  getRevision: () => number
  isTransactionActive: () => boolean
  createSandbox: (protocol: IVideoProtocol) => EditorCore
  applySnapshot: (protocol: IVideoProtocol, proposal: EditorProposal) => 'committed' | 'empty' | 'cancelled' | 'invalid' | 'nested'
  createId: () => string
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function segmentMap(protocol: IVideoProtocol) {
  const segments = new Map<string, SegmentUnion>()
  for (const track of protocol.tracks) {
    for (const segment of track.children)
      segments.set(segment.id, segment)
  }
  return segments
}

function trackMap(protocol: IVideoProtocol) {
  return new Map(protocol.tracks.map(track => [track.trackId, track] as const))
}

function changedIds<T>(before: Map<string, T>, after: Map<string, T>) {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []

  for (const [id, value] of after) {
    const previous = before.get(id)
    if (previous === undefined)
      added.push(id)
    else if (!sameValue(previous, value))
      changed.push(id)
  }
  for (const id of before.keys()) {
    if (!after.has(id))
      removed.push(id)
  }

  return { added, removed, changed }
}

export function summarizeProposal(before: IVideoProtocol, after: IVideoProtocol): ProposalChangeSummary {
  const tracks = changedIds<TrackUnion>(trackMap(before), trackMap(after))
  const segments = changedIds<SegmentUnion>(segmentMap(before), segmentMap(after))
  const projectFields: ProposalChangeSummary['projectFields'][number][] = []

  for (const field of ['width', 'height', 'fps'] as const) {
    if (before[field] !== after[field])
      projectFields.push(field)
  }

  return {
    addedTrackIds: tracks.added,
    removedTrackIds: tracks.removed,
    changedTrackIds: tracks.changed,
    addedSegmentIds: segments.added,
    removedSegmentIds: segments.removed,
    changedSegmentIds: segments.changed,
    projectFields,
  }
}

function cloneProposal(proposal: EditorProposal): EditorProposal {
  return structuredClone(proposal)
}

function errorResult(error: unknown): ProposalActionResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }
}

export function createProposalManager(deps: ProposalManagerDependencies): EditorProposalManager {
  const proposals = new Map<string, EditorProposal>()

  const create: EditorProposalManager['create'] = (build, options) => {
    const id = options?.id ?? deps.createId()
    if (!id)
      return { success: false, error: 'proposal id must not be empty' }
    if (proposals.has(id))
      return { success: false, error: `proposal id ${id} already exists` }

    const baseRevision = deps.getRevision()
    const before = structuredClone(deps.getProtocol())
    const sandbox = deps.createSandbox(before)

    try {
      build(sandbox)
      const previewProtocol = structuredClone(sandbox.commands.exportProtocol())
      if (sameValue(before, previewProtocol))
        return { success: false, error: 'proposal must change the protocol' }

      const operations = sandbox.selectors.getOperationLog()
        .filter(entry => entry.status === 'applied')
        .flatMap(entry => entry.operations.length
          ? entry.operations
          : entry.meta === undefined ? [] : [entry.meta])

      const proposal: EditorProposal = {
        id,
        baseRevision,
        previewProtocol,
        validation: { valid: true },
        operations: structuredClone(operations),
        summary: summarizeProposal(before, previewProtocol),
      }
      proposals.set(id, proposal)
      return { success: true, proposal: cloneProposal(proposal) }
    }
    catch (error) {
      return errorResult(error)
    }
  }

  const accept: EditorProposalManager['accept'] = (id) => {
    const proposal = proposals.get(id)
    if (!proposal)
      return { success: false, error: `no proposal with id ${id}` }
    if (deps.isTransactionActive())
      return { success: false, error: 'cannot accept a proposal while a transaction is active' }
    if (deps.getRevision() !== proposal.baseRevision) {
      return {
        success: false,
        error: `proposal ${id} conflicts with the current protocol revision`,
      }
    }

    try {
      const status = deps.applySnapshot(proposal.previewProtocol, proposal)
      if (status !== 'committed')
        return { success: false, error: `proposal ${id} could not be committed: ${status}` }
      proposals.delete(id)
      return { success: true, proposal: cloneProposal(proposal) }
    }
    catch (error) {
      return errorResult(error)
    }
  }

  const reject: EditorProposalManager['reject'] = (id) => {
    const proposal = proposals.get(id)
    if (!proposal)
      return { success: false, error: `no proposal with id ${id}` }
    proposals.delete(id)
    return { success: true, proposal: cloneProposal(proposal) }
  }

  return {
    create,
    accept,
    reject,
    get: (id) => {
      const proposal = proposals.get(id)
      return proposal === undefined ? undefined : cloneProposal(proposal)
    },
    list: () => [...proposals.values()].map(cloneProposal),
  }
}
