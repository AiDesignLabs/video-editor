import type { ITrackType, TrackUnion } from '@video-editor/shared'
import type {
  EditorCore,
  EditorCoreCommands,
  EditorCoreContext,
  EditorCoreOptions,
  EditorCoreSelectors,
  EditorCoreState,
} from './types'
import { createVideoProtocolManager } from '@video-editor/protocol'
import { computed } from '@vue/reactivity'
import { createBatchCommands } from './batch'
import { createKeyframeCommands } from './keyframes'
import { createPluginManager } from './plugin'
import { createProposalManager } from './proposal'
import { createSegmentRegistry } from './segment'
import { createStructuralSelectors } from './selectors'

function computeDuration(tracks: TrackUnion[]) {
  let max = 0
  for (const track of tracks) {
    for (const segment of track.children) {
      if (segment.endTime > max)
        max = segment.endTime
    }
  }
  return max
}

export function createEditorCore(options: EditorCoreOptions): EditorCore {
  const protocolManager = createVideoProtocolManager(options.protocol, {
    idFactory: options.idFactory,
  })

  const selectedSegmentId = computed(() => protocolManager.selectedSegment.value?.id)
  const duration = computed(() => computeDuration(protocolManager.protocol.value.tracks))

  const state: EditorCoreState = {
    protocol: protocolManager.protocol,
    videoBasicInfo: protocolManager.videoBasicInfo,
    currentTime: protocolManager.curTime,
    selectedSegment: protocolManager.selectedSegment,
    selectedSegmentId,
    trackMap: protocolManager.trackMap,
    segmentMap: protocolManager.segmentMap,
    duration,
    undoCount: protocolManager.undoCount,
    redoCount: protocolManager.redoCount,
    operationLog: protocolManager.operationLog,
    revision: protocolManager.revision,
    isTransactionActive: protocolManager.isTransactionActive,
    transactionDepth: protocolManager.transactionDepth,
  }

  const batch = createBatchCommands({
    transaction: protocolManager.transaction,
    moveSegment: protocolManager.moveSegment,
    removeSegment: protocolManager.removeSegment,
    duplicateSegment: protocolManager.duplicateSegment,
    updateSegment: protocolManager.updateSegment,
    getSegment: protocolManager.getSegment,
  })
  const keyframes = createKeyframeCommands({
    getSegment: protocolManager.getSegment,
    updateSegment: protocolManager.updateSegment,
    transaction: protocolManager.transaction,
  })

  const commands: EditorCoreCommands = {
    setCurrentTime: (time) => {
      protocolManager.curTime.value = time
    },
    setSelectedSegment: protocolManager.setSelectedSegment,
    addSegment: protocolManager.addSegment,
    removeSegment: protocolManager.removeSegment,
    duplicateSegment: protocolManager.duplicateSegment,
    updateSegment: protocolManager.updateSegment,
    moveSegment: protocolManager.moveSegment,
    resizeSegment: protocolManager.resizeSegment,
    replaceSegmentAsset: protocolManager.replaceSegmentAsset,
    splitSegment: protocolManager.splitSegment,
    addTransition: protocolManager.addTransition,
    removeTransition: protocolManager.removeTransition,
    updateTransition: protocolManager.updateTransition,
    addTrack: protocolManager.addTrack,
    removeTrack: protocolManager.removeTrack,
    moveTrack: protocolManager.moveTrack,
    updateTrack: protocolManager.updateTrack,
    setCanvasSize: protocolManager.setCanvasSize,
    setFps: protocolManager.setFps,
    upsertKeyframe: keyframes.upsertKeyframe,
    moveKeyframe: keyframes.moveKeyframe,
    removeKeyframe: keyframes.removeKeyframe,
    setKeyframeEasing: keyframes.setKeyframeEasing,
    replaceTrackId: protocolManager.replaceTrackId,
    replaceSegmentId: protocolManager.replaceSegmentId,
    moveSegments: batch.moveSegments,
    removeSegments: batch.removeSegments,
    updateSegments: batch.updateSegments,
    duplicateSegments: batch.duplicateSegments,
    transaction: protocolManager.transaction,
    beginTransaction: protocolManager.beginTransaction,
    undo: protocolManager.undo,
    redo: protocolManager.redo,
    exportProtocol: protocolManager.exportProtocol,
  }

  const structural = createStructuralSelectors({
    protocol: () => protocolManager.exportProtocol(),
    selectedSegmentId: () => selectedSegmentId.value,
    undoCount: () => protocolManager.undoCount.value,
    redoCount: () => protocolManager.redoCount.value,
  })

  const selectors: EditorCoreSelectors = {
    ...structural,
    getSegment: protocolManager.getSegment,
    getTrackById: (trackId: string) => state.protocol.value.tracks.find(track => track.trackId === trackId),
    getTrackBySegmentId: (segmentId: string) => state.protocol.value.tracks.find(track => track.children.some(segment => segment.id === segmentId)),
    getTracks: (trackType?: ITrackType) => {
      if (!trackType)
        return state.protocol.value.tracks
      return state.protocol.value.tracks.filter(track => track.trackType === trackType)
    },
    getOperationLog: () => structuredClone(state.operationLog.value),
  }

  const registry = {
    segments: createSegmentRegistry(),
  }

  const services = options.services ?? {}

  const context: EditorCoreContext = {
    state,
    commands,
    selectors,
    registry,
    services,
  }

  const plugins = createPluginManager(context)
  const proposals = createProposalManager({
    getProtocol: () => protocolManager.exportProtocol(),
    getRevision: () => protocolManager.revision.value,
    isTransactionActive: () => protocolManager.isTransactionActive.value,
    createSandbox: protocol => createEditorCore({
      protocol,
      idFactory: options.idFactory,
    }),
    applySnapshot: (protocol, proposal) => protocolManager.applyProtocolSnapshot(protocol, {
      label: 'accept-proposal',
      data: { proposalId: proposal.id, baseRevision: proposal.baseRevision },
      operations: proposal.operations,
    }).status,
    createId: options.idFactory?.proposal ?? (() => globalThis.crypto.randomUUID()),
  })

  return {
    state,
    commands,
    selectors,
    proposals,
    plugins,
    registry,
    services,
    destroy: async () => {
      await plugins.destroy()
    },
  }
}
