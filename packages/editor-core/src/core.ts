import { computed } from '@vue/reactivity'
import type { ITrackType, TrackUnion } from '@video-editor/shared'
import { createVideoProtocolManager } from '@video-editor/protocol'
import type {
  EditorCore,
  EditorCoreCommands,
  EditorCoreContext,
  EditorCoreOptions,
  EditorCoreSelectors,
  EditorCoreState,
} from './types'
import { createPluginManager } from './plugin'
import { createSegmentRegistry } from './segment'

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
  }

  const commands: EditorCoreCommands = {
    setCurrentTime: (time) => {
      protocolManager.curTime.value = time
    },
    setSelectedSegment: protocolManager.setSelectedSegment,
    addSegment: protocolManager.addSegment,
    removeSegment: protocolManager.removeSegment,
    updateSegment: protocolManager.updateSegment,
    moveSegment: protocolManager.moveSegment,
    resizeSegment: protocolManager.resizeSegment,
    addTransition: protocolManager.addTransition,
    removeTransition: protocolManager.removeTransition,
    updateTransition: protocolManager.updateTransition,
    replaceTrackId: protocolManager.replaceTrackId,
    undo: protocolManager.undo,
    redo: protocolManager.redo,
    exportProtocol: protocolManager.exportProtocol,
  }

  const selectors: EditorCoreSelectors = {
    getSegment: protocolManager.getSegment,
    getTrackById: (trackId: string) => state.protocol.value.tracks.find(track => track.trackId === trackId),
    getTrackBySegmentId: (segmentId: string) => state.protocol.value.tracks.find(track => track.children.some(segment => segment.id === segmentId)),
    getTracks: (trackType?: ITrackType) => {
      if (!trackType)
        return state.protocol.value.tracks
      return state.protocol.value.tracks.filter(track => track.trackType === trackType)
    },
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

  return {
    state,
    commands,
    selectors,
    plugins,
    registry,
    services,
    destroy: async () => {
      await plugins.destroy()
    },
  }
}
