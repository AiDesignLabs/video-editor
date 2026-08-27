import type { IAudioSegment, ITrack, ITrackType, ITransition, ITransitionEdge, IVideoFramesSegment, IVideoProtocol, SegmentUnion, TrackTypeMapSegment, TrackTypeMapTrack, TrackUnion } from '@video-editor/shared'
import type { DeepReadonly } from '@vue/reactivity'
import type { PartialByKeys } from './utils'
import { isAudioSegment, isVideoFramesSegment, sampleKeyframes } from '@video-editor/shared'
import { computed, reactive, readonly, ref, toRaw } from '@vue/reactivity'
import { createValidator } from '../verify'
import { useHistory } from './immer'
import { checkSegment, handleSegmentUpdate } from './segment'
import { clone, findInsertFramesSegmentIndex, findInsertSegmentIndex, genRandomId } from './utils'

function cloneAffectedSegments(segments: SegmentUnion | SegmentUnion[]) {
  const toPlain = (segment: SegmentUnion) => JSON.parse(JSON.stringify(toRaw(segment))) as SegmentUnion
  return Array.isArray(segments)
    ? segments.map(segment => toPlain(segment))
    : [toPlain(segments)]
}

function cloneTrack(track: TrackUnion): TrackUnion {
  return JSON.parse(JSON.stringify(toRaw(track))) as TrackUnion
}

type ProtocolSnapshot = {
  trackIds: Set<string>
  trackById: Map<string, TrackUnion>
  segments: Map<string, { signature: string, trackId: string, segment: SegmentUnion }>
}

function snapshotProtocolState(protocol: IVideoProtocol): ProtocolSnapshot {
  const trackIds = new Set<string>()
  const trackById = new Map<string, TrackUnion>()
  const segments = new Map<string, { signature: string, trackId: string, segment: SegmentUnion }>()

  for (const track of protocol.tracks) {
    const trackCopy = cloneTrack(track)
    trackIds.add(trackCopy.trackId)
    trackById.set(trackCopy.trackId, trackCopy)
    for (const segment of trackCopy.children) {
      const signature = JSON.stringify(segment)
      segments.set(segment.id, { signature, trackId: trackCopy.trackId, segment })
    }
  }

  return { trackIds, trackById, segments }
}

function diffProtocolSnapshots(prev: ProtocolSnapshot, next: ProtocolSnapshot) {
  const addedTracks: TrackUnion[] = []
  const removedTrackIds: string[] = []
  const affectedTrackIds = new Set<string>()
  const affectedSegments: SegmentUnion[] = []
  const removedSegmentIds: string[] = []

  for (const [trackId, track] of next.trackById.entries()) {
    if (!prev.trackIds.has(trackId))
      addedTracks.push(track)
  }

  for (const trackId of prev.trackIds) {
    if (!next.trackIds.has(trackId))
      removedTrackIds.push(trackId)
  }

  for (const [segmentId, nextEntry] of next.segments.entries()) {
    const prevEntry = prev.segments.get(segmentId)
    if (!prevEntry || prevEntry.signature !== nextEntry.signature) {
      affectedSegments.push(nextEntry.segment)
      affectedTrackIds.add(nextEntry.trackId)
    }
  }

  for (const [segmentId, prevEntry] of prev.segments.entries()) {
    if (!next.segments.has(segmentId) && !removedTrackIds.includes(prevEntry.trackId)) {
      removedSegmentIds.push(segmentId)
      affectedTrackIds.add(prevEntry.trackId)
    }
  }

  const affectedTracks: TrackUnion[] = []
  for (const trackId of affectedTrackIds) {
    const track = next.trackById.get(trackId)
    if (track)
      affectedTracks.push(track)
  }

  return {
    affectedSegments,
    affectedTracks,
    addedTracks,
    removedTrackIds,
    removedSegmentIds,
  }
}

function isSegmentWithFromTime(segment: SegmentUnion): segment is IVideoFramesSegment | IAudioSegment {
  return isVideoFramesSegment(segment) || isAudioSegment(segment)
}

function normalizeSegmentPlayRate(segment: IVideoFramesSegment | IAudioSegment): number {
  const rate = segment.playRate
  if (typeof rate !== 'number' || !Number.isFinite(rate))
    return 1
  return Math.min(100, Math.max(0.1, rate))
}

function getMainFramesTrack(protocol: IVideoProtocol): TrackTypeMapTrack['frames'] | undefined {
  return protocol.tracks.find(track => track.trackType === 'frames' && (track as TrackTypeMapTrack['frames']).isMain) as TrackTypeMapTrack['frames'] | undefined
}

function isValidTransitionData(transition: ITransition | undefined): transition is ITransition {
  if (!transition || typeof transition !== 'object')
    return false
  if (typeof transition.id !== 'string' || typeof transition.name !== 'string')
    return false
  return typeof transition.duration === 'number' && Number.isFinite(transition.duration) && transition.duration >= 0
}

function isValidTransitionEdgeData(edge: ITransitionEdge | undefined): edge is ITransitionEdge {
  if (!edge || typeof edge !== 'object')
    return false
  if (typeof edge.fromSegmentId !== 'string' || typeof edge.toSegmentId !== 'string')
    return false
  return isValidTransitionData(edge)
}

function collectExplicitTransitionEdges(mainTrack: TrackTypeMapTrack['frames'], protocol: IVideoProtocol): Map<string, ITransitionEdge> {
  const adjacentToByFrom = new Map<string, string>()
  for (let i = 0; i < mainTrack.children.length - 1; i++) {
    const fromSegment = mainTrack.children[i]
    const toSegment = mainTrack.children[i + 1]
    adjacentToByFrom.set(fromSegment.id, toSegment.id)
  }

  const edgeByFrom = new Map<string, ITransitionEdge>()
  for (const edge of protocol.transitions ?? []) {
    if (!isValidTransitionEdgeData(edge))
      continue
    if (adjacentToByFrom.get(edge.fromSegmentId) !== edge.toSegmentId)
      continue
    edgeByFrom.set(edge.fromSegmentId, {
      id: edge.id,
      name: edge.name,
      duration: edge.duration,
      fromSegmentId: edge.fromSegmentId,
      toSegmentId: edge.toSegmentId,
    })
  }

  return edgeByFrom
}

function syncProtocolTransitionEdges(protocol: IVideoProtocol) {
  const mainTrack = getMainFramesTrack(protocol)
  if (!mainTrack || mainTrack.children.length < 2) {
    protocol.transitions = []
    return
  }
  const edgeByFrom = collectExplicitTransitionEdges(mainTrack, protocol)
  const transitions: ITransitionEdge[] = []
  for (let i = 0; i < mainTrack.children.length - 1; i++) {
    const fromSegment = mainTrack.children[i]
    const toSegment = mainTrack.children[i + 1]
    const edge = edgeByFrom.get(fromSegment.id)
    if (!edge || edge.toSegmentId !== toSegment.id)
      continue
    transitions.push({
      id: edge.id,
      name: edge.name,
      duration: edge.duration,
      fromSegmentId: fromSegment.id,
      toSegmentId: toSegment.id,
    })
  }
  protocol.transitions = transitions
}

function normalizeProtocolTransitions(protocol: IVideoProtocol) {
  const mainTrack = getMainFramesTrack(protocol)
  if (!mainTrack || mainTrack.children.length < 2) {
    protocol.transitions = []
    return
  }
  syncProtocolTransitionEdges(protocol)
}

export function createVideoProtocolManager(protocol: IVideoProtocol, options?: {
  idFactory?: {
    segment?: () => string
    track?: () => string
  }
}) {
  const validator = createValidator()

  const {
    videoBasicInfo,
    segments,
    tracks,
    updateProtocol,
    undo: undoHistory,
    redo: redoHistory,
    exportProtocol,
    undoCount,
    redoCount,
    protocol: protocolRef,
  } = normalizedProtocol(validator.verify(protocol))

  const curTime = ref(0)
  const selectedSegmentId = ref<string>()
  const selectedSegment = computed(() => {
    if (!selectedSegmentId.value)
      return
    return segments.value[selectedSegmentId.value]
  })
  const setSelectedSegment = (id?: SegmentUnion['id']) => {
    selectedSegmentId.value = id
  }

  const updateProtocolWithTransitionSync = <T>(updater: (protocol: IVideoProtocol) => T) => {
    return updateProtocol((protocol) => {
      const result = updater(protocol)
      syncProtocolTransitionEdges(protocol)
      return result
    })
  }

  const addSegmentToTrack = <T extends SegmentUnion>(segment: T, tracks: IVideoProtocol['tracks']) => {
    const hasMainFrames = tracks.some(track => track.trackType === 'frames' && (track as TrackTypeMapTrack['frames']).isMain)
    const isMainFrames = segment.segmentType === 'frames' && !hasMainFrames
    const track = {
      isMain: isMainFrames ? true : undefined,
      trackType: segment.segmentType,
      trackId: options?.idFactory?.track?.() ?? genRandomId(),
      children: [segment],
    } satisfies ITrack<ITrackType> as TrackUnion

    if (isMainFrames) {
      tracks.push(track)
    }
    else {
      tracks.unshift(track)
    }
    return segment.id
  }

  /**
   * Insert a frames segment into a frames track and rebuild the timeline
   * This is the core logic for frames track operations, reused by addSegment, moveSegment, etc.
   */
  const insertFramesSegmentIntoTrack = (
    framesSegment: TrackTypeMapSegment['frames'],
    track: TrackTypeMapTrack['frames'],
    insertTime: number,
  ) => {
    if (track.isMain) {
      const insertIndex = findInsertFramesSegmentIndex(track.children, insertTime)
      const duration = framesSegment.endTime - framesSegment.startTime

      // Calculate segment position based on insert index
      if (insertIndex === 0) {
        framesSegment.startTime = 0
        framesSegment.endTime = duration
      }
      else {
        const prevSegment = track.children[insertIndex - 1]
        framesSegment.startTime = prevSegment.endTime
        framesSegment.endTime = prevSegment.endTime + duration
      }

      // Insert segment
      track.children.splice(insertIndex, 0, framesSegment)

      // Rebuild timeline from insert position onwards
      for (let j = insertIndex; j < track.children.length; j++) {
        const segment = track.children[j]
        const preSegmentEndTime = track.children[j - 1]?.endTime ?? 0
        const segDuration = segment.endTime - segment.startTime
        segment.startTime = preSegmentEndTime
        segment.endTime = preSegmentEndTime + segDuration
      }
    }
    else {
      // For non-main tracks, just add the segment and sort
      track.children.push(framesSegment)
      track.children.sort((a, b) => a.startTime - b.startTime)
    }

    return framesSegment.id
  }

  /**
   * Rebuild track timeline from a specific segment index
   * - Main frames track: ensures no gaps (continuous timeline)
   * - Other tracks (including non-main frames): allows gaps but prevents overlaps
   */
  const rebuildTrackTimeline = (track: TrackUnion, fromIndex = 0) => {
    const children = track.children

    // Sort by startTime first
    children.sort((a, b) => a.startTime - b.startTime)

    // Check if this is main frames track
    const isMainFramesTrack = track.trackType === 'frames' && (track as TrackTypeMapTrack['frames']).isMain

    // Rebuild timeline from the specified index
    for (let i = fromIndex; i < children.length; i++) {
      const seg = children[i]
      const duration = seg.endTime - seg.startTime
      const prevSeg = children[i - 1]

      if (!prevSeg) {
        // First segment: main frames track must start at 0
        if (isMainFramesTrack) {
          seg.startTime = 0
          seg.endTime = duration
        }
        continue
      }

      if (isMainFramesTrack) {
        // Main frames track: no gaps allowed, each segment follows previous immediately
        seg.startTime = prevSeg.endTime
        seg.endTime = prevSeg.endTime + duration
      }
      else {
        // Other tracks: allow gaps but prevent overlaps
        if (seg.startTime < prevSeg.endTime) {
          // Overlap detected, push this segment to start right after previous
          seg.startTime = prevSeg.endTime
          seg.endTime = prevSeg.endTime + duration
        }
        // else: no overlap, keep original time (allows gaps)
      }
    }
  }

  const normalizedSegment = (segment: PartialByKeys<TrackTypeMapSegment[ITrackType], 'id'>) => {
    const _segment = clone(segment) as TrackTypeMapSegment[ITrackType]
    if (!_segment.id || segments.value[_segment.id])
      _segment.id = options?.idFactory?.segment?.() ?? genRandomId()

    const diff = curTime.value - _segment.startTime
    _segment.startTime += diff
    _segment.endTime += diff

    return _segment
  }

  const getSegment = <T extends ITrackType>(id: SegmentUnion['id'], type?: T): DeepReadonly<TrackTypeMapSegment[T]> | undefined => {
    const segment = segments.value[id]
    if (segment && segment.segmentType === type)
      return segment as DeepReadonly<TrackTypeMapSegment[T]>
    else if (segment && !type)
      return segment as any
    return undefined
  }

  const addSegment = (segment: PartialByKeys<TrackTypeMapSegment[ITrackType], 'id'>, trackId?: string): {
    id: string
    affectedSegments: SegmentUnion[]
    affectedTracks: TrackUnion[]
    createdTracks: TrackUnion[]
    removedTrackIds: string[]
  } => {
    const theSegment = normalizedSegment(segment)
    const affectedTrackIds = new Set<string>()
    const createdTracks: TrackUnion[] = []
    const affectedTracks: TrackUnion[] = []
    const removedTrackIds: string[] = []

    try {
      validator.verifySegment(theSegment)
    }
    catch {
      throw new Error('invalid segment data')
    }

    const id = updateProtocolWithTransitionSync((protocol) => {
      if (theSegment.segmentType === 'frames') {
        const newClipStart = theSegment.startTime
        const newClipEnd = theSegment.endTime

        const frameTracks = protocol.tracks.filter(track => track.trackType === 'frames') as TrackTypeMapTrack['frames'][]
        // Prefer a specified track if it has space
        let targetTrack: TrackTypeMapTrack['frames'] | undefined
        if (trackId) {
          const specifiedTrack = frameTracks.find(track => track.trackId === trackId)
          if (specifiedTrack) {
            const hasOverlap = specifiedTrack.children.some(clip => (clip.startTime < newClipEnd) && (clip.endTime > newClipStart))
            if (!hasOverlap)
              targetTrack = specifiedTrack
          }
        }

        // If no specified track or it had overlap, find any other frames track with space
        if (!targetTrack) {
          for (const track of frameTracks) {
            // Don't check the specified track again
            if (track.trackId === trackId)
              continue
            const hasOverlap = track.children.some(clip => (clip.startTime < newClipEnd) && (clip.endTime > newClipStart))
            if (!hasOverlap) {
              targetTrack = track
              break
            }
          }
        }

        if (targetTrack) {
          // Found a track with space, add segment and sort.
          targetTrack.children.push(theSegment)
          targetTrack.children.sort((a, b) => a.startTime - b.startTime)
          affectedTrackIds.add(targetTrack.trackId)
          return theSegment.id
        }

        // No space in any existing frames track, create a new one.
        const newId = addSegmentToTrack(theSegment, protocol.tracks)
        const newTrack = protocol.tracks.find(t => t.children.some(s => s.id === newId))
        if (newTrack) {
          createdTracks.push(cloneTrack(newTrack))
          affectedTrackIds.add(newTrack.trackId)
        }
        return newId
      }

      const tracks = protocol.tracks
      for (let i = tracks.length - 1; i >= 0; i--) {
        if (tracks[i].trackType !== theSegment.segmentType)
          continue
        const children = tracks[i].children as SegmentUnion[]
        const index = findInsertSegmentIndex(theSegment, children, curTime.value)
        if (index !== -1) {
          children.splice(index, 0, theSegment)
          // For non-frames tracks, only the added segment is affected (no auto-rebuild)
          affectedTrackIds.add(tracks[i].trackId)
          return theSegment.id
        }
      }

      const newId = addSegmentToTrack(theSegment, tracks)
      // Find the track that was just created
      const newTrack = protocol.tracks.find(t => t.children.some(s => s.id === newId))
      if (newTrack) {
        createdTracks.push(cloneTrack(newTrack))
        affectedTrackIds.add(newTrack.trackId)
      }
      return newId
    })

    // Collect affected segments from the final protocol state (not from Immer drafts)
    const affectedSegments: SegmentUnion[] = []
    if (affectedTrackIds.size > 0) {
      const currentProtocol = exportProtocol()
      for (const trackId of affectedTrackIds) {
        const track = currentProtocol.tracks.find(t => t.trackId === trackId)
        if (track) {
          affectedSegments.push(...cloneAffectedSegments(track.children))
          affectedTracks.push(cloneTrack(track))
        }
      }
    }

    return { id, affectedSegments, affectedTracks, createdTracks, removedTrackIds }
  }

  const removeSegment = (id: SegmentUnion['id']): {
    success: boolean
    affectedSegments: SegmentUnion[]
    affectedTracks: TrackUnion[]
    createdTracks: TrackUnion[]
    removedTrackIds: string[]
  } => {
    let affectedTrackId: string | null = null
    const affectedTracks: TrackUnion[] = []
    const createdTracks: TrackUnion[] = []
    const removedTrackIds: string[] = []

    const success = updateProtocolWithTransitionSync((protocol) => {
      for (let i = 0; i < protocol.tracks.length; i++) {
        const track = protocol.tracks[i]
        const index = track.children.findIndex(segment => segment.id === id)
        if (index !== -1) {
          track.children.splice(index, 1)

          // If track still has segments and it's a main frames track, rebuild timeline
          if (track.children.length > 0) {
            const isMainFramesTrack = track.trackType === 'frames' && (track as TrackTypeMapTrack['frames']).isMain
            if (isMainFramesTrack) {
              rebuildTrackTimeline(track, 0)
              // All remaining segments may be affected
              affectedTrackId = track.trackId
            }
          }
          else {
            const isMainFramesTrack = track.trackType === 'frames' && (track as TrackTypeMapTrack['frames']).isMain
            if (isMainFramesTrack) {
              // Keep main frames track even if empty
              affectedTrackId = track.trackId
            }
            else {
              // Remove empty track
              protocol.tracks.splice(i, 1)
              removedTrackIds.push(track.trackId)
              // No affected segments since track was deleted
            }
          }

          return true
        }
      }
      return false
    })

    // Collect affected segments from the final protocol state (not from Immer drafts)
    const affectedSegments: SegmentUnion[] = []
    if (success && affectedTrackId) {
      const currentProtocol = exportProtocol()
      const track = currentProtocol.tracks.find(t => t.trackId === affectedTrackId)
      if (track) {
        affectedSegments.push(...cloneAffectedSegments(track.children))
        affectedTracks.push(cloneTrack(track))
      }
    }

    return { success, affectedSegments, affectedTracks, createdTracks, removedTrackIds }
  }

  const moveSegment = (moveOptions: {
    segmentId: string
    sourceTrackId: string
    targetTrackId?: string
    startTime: number
    endTime: number
    isNewTrack?: boolean
    newTrackInsertIndex?: number
    newTrackId?: string
  }): {
    success: boolean
    affectedSegments: SegmentUnion[]
    affectedTracks: TrackUnion[]
    createdTracks: TrackUnion[]
    removedTrackIds: string[]
  } => {
    // Track which segments/tracks are affected (store IDs instead of objects)
    const affectedTrackIds = new Set<string>()
    const affectedTracks: TrackUnion[] = []
    const createdTracks: TrackUnion[] = []
    const removedTrackIds: string[] = []

    const success = updateProtocolWithTransitionSync((protocol) => {
      // Find source track and segment
      const sourceTrack = protocol.tracks.find(t => t.trackId === moveOptions.sourceTrackId)
      if (!sourceTrack)
        return false

      const segmentIndex = sourceTrack.children.findIndex(seg => seg.id === moveOptions.segmentId)
      if (segmentIndex < 0)
        return false

      const segment = sourceTrack.children[segmentIndex]

      // Check if moving within same track (same trackId and not creating new track)
      const isSameTrack = moveOptions.targetTrackId === moveOptions.sourceTrackId && moveOptions.isNewTrack !== true

      if (isSameTrack) {
        // Moving within same track - just update time and rebuild to avoid overlaps
        segment.startTime = moveOptions.startTime
        segment.endTime = moveOptions.endTime
        rebuildTrackTimeline(sourceTrack)

        // All segments in the track may be affected
        affectedTrackIds.add(sourceTrack.trackId)
      }
      else {
        // Moving to different track or creating new track
        // Step 1: Remove from source track
        sourceTrack.children.splice(segmentIndex, 1)

        // Step 2: Rebuild source track timeline to avoid overlaps
        if (sourceTrack.children.length > 0) {
          rebuildTrackTimeline(sourceTrack)
          // Source track segments are affected
          affectedTrackIds.add(sourceTrack.trackId)
        }

        // Step 3: Delete source track if empty
        if (sourceTrack.children.length === 0) {
          const trackIdx = protocol.tracks.findIndex(t => t.trackId === sourceTrack.trackId)
          if (trackIdx >= 0) {
            protocol.tracks.splice(trackIdx, 1)
            removedTrackIds.push(sourceTrack.trackId)
          }
        }

        // Step 4: Update segment time
        segment.startTime = moveOptions.startTime
        segment.endTime = moveOptions.endTime

        // Step 5: Add to target track or create new track
        if (moveOptions.isNewTrack && moveOptions.newTrackInsertIndex !== undefined) {
          // Create new track
          const isFirstFramesTrack = segment.segmentType === 'frames'
            && !protocol.tracks.some(t => t.trackType === 'frames' && (t as TrackTypeMapTrack['frames']).isMain)

          const newTrack: TrackUnion = {
            trackId: moveOptions.newTrackId ?? options?.idFactory?.track?.() ?? genRandomId(),
            trackType: segment.segmentType,
            children: [segment],
            ...(isFirstFramesTrack ? { isMain: true } : {}),
          } as TrackUnion

          // Only main frames track requires segments to start at 0
          // Non-main frames tracks can have segments at any time position
          if (isFirstFramesTrack) {
            const duration = segment.endTime - segment.startTime
            segment.startTime = 0
            segment.endTime = duration
          }
          // For non-main tracks (including non-main frames), keep user's drag position

          protocol.tracks.splice(moveOptions.newTrackInsertIndex, 0, newTrack)

          // The moved segment is affected
          affectedTrackIds.add(newTrack.trackId)
          createdTracks.push(cloneTrack(newTrack))
        }
        else if (moveOptions.targetTrackId) {
          // Add to existing target track
          const targetTrack = protocol.tracks.find(t => t.trackId === moveOptions.targetTrackId)
          if (!targetTrack || targetTrack.trackType !== segment.segmentType)
            return false

          if (targetTrack.trackType === 'frames') {
            // Frames track: reuse insertFramesSegmentIntoTrack helper
            const framesSegment = segment as TrackTypeMapSegment['frames']
            insertFramesSegmentIntoTrack(
              framesSegment,
              targetTrack as TrackTypeMapTrack['frames'],
              segment.startTime,
            )
          }
          else {
            // Other tracks: add and rebuild to avoid overlaps
            ;(targetTrack.children as SegmentUnion[]).push(segment)
            rebuildTrackTimeline(targetTrack)
          }

          // All segments in target track are affected
          affectedTrackIds.add(targetTrack.trackId)
        }
      }

      return true
    })

    const affectedSegments: SegmentUnion[] = []
    if (success) {
      const currentProtocol = exportProtocol()
      for (const trackId of affectedTrackIds) {
        const track = currentProtocol.tracks.find(t => t.trackId === trackId)
        if (track) {
          affectedSegments.push(...cloneAffectedSegments(track.children))
          affectedTracks.push(cloneTrack(track))
        }
      }
    }

    return { success, affectedSegments, affectedTracks, createdTracks, removedTrackIds }
  }

  const resizeSegment = (options: {
    segmentId: string
    trackId: string
    startTime: number
    endTime: number
  }): {
    success: boolean
    affectedSegments: SegmentUnion[]
    affectedTracks: TrackUnion[]
    createdTracks: TrackUnion[]
    removedTrackIds: string[]
  } => {
    let affectedTrackId: string | null = null
    const affectedTracks: TrackUnion[] = []
    const createdTracks: TrackUnion[] = []
    const removedTrackIds: string[] = []

    const success = updateProtocolWithTransitionSync((protocol) => {
      const track = protocol.tracks.find(t => t.trackId === options.trackId)
      if (!track)
        return false

      const segmentIndex = track.children.findIndex(seg => seg.id === options.segmentId)
      if (segmentIndex < 0)
        return false

      const segment = track.children[segmentIndex]

      const originalStartTime = segment.startTime

      let nextStartTime = options.startTime
      let nextEndTime = options.endTime
      let nextDuration = nextEndTime - nextStartTime
      if (!Number.isFinite(nextDuration) || nextDuration < 0)
        return false

      const segmentWithFromTime = isSegmentWithFromTime(segment) ? segment : null
      let nextFromTime = segmentWithFromTime ? (segmentWithFromTime.fromTime ?? 0) : 0

      // When resizing the start edge, keep the media content aligned by updating fromTime.
      // - Trimming in (startTime increases) => fromTime increases
      // - Extending left (startTime decreases) => fromTime decreases (clamped at 0)
      if (segmentWithFromTime && nextStartTime !== originalStartTime) {
        const originalFromTime = segmentWithFromTime.fromTime ?? 0
        // Timeline deltas map to source time scaled by playRate (see evaluator sourceMs formula).
        const playRate = normalizeSegmentPlayRate(segmentWithFromTime)
        const requestedDeltaStart = nextStartTime - originalStartTime
        const clampedDeltaStart = Math.max(requestedDeltaStart, -originalFromTime / playRate)

        if (clampedDeltaStart !== requestedDeltaStart) {
          nextStartTime = originalStartTime + clampedDeltaStart
          nextDuration = nextEndTime - nextStartTime
        }
        if (!Number.isFinite(nextDuration) || nextDuration < 0)
          return false

        nextFromTime = Math.max(0, originalFromTime + clampedDeltaStart * playRate)
        segmentWithFromTime.fromTime = nextFromTime
      }

      // Update segment time (duration is the primary invariant, especially for main frames tracks).
      segment.startTime = nextStartTime
      segment.endTime = nextEndTime

      // Rebuild timeline from current segment onwards to avoid overlaps
      rebuildTrackTimeline(track, segmentIndex)

      // Track the affected track ID
      affectedTrackId = track.trackId

      return true
    })

    // Collect affected segments from the final protocol state (not from Immer drafts)
    const affectedSegments: SegmentUnion[] = []
    if (success && affectedTrackId) {
      const currentProtocol = exportProtocol()
      const track = currentProtocol.tracks.find(t => t.trackId === affectedTrackId)
      if (track) {
        affectedSegments.push(...cloneAffectedSegments(track.children))
      }
    }

    return { success, affectedSegments, affectedTracks, createdTracks, removedTrackIds }
  }

  const splitSegment = (segmentId: string, timelineMs: number): {
    success: boolean
    leftId: string
    rightId: string
    affectedSegments: SegmentUnion[]
  } => {
    let affectedTrackId: string | null = null
    let rightId = ''

    const success = updateProtocolWithTransitionSync((protocol) => {
      const track = protocol.tracks.find(t => t.children.some(s => s.id === segmentId))
      if (!track)
        return false
      const index = track.children.findIndex(s => s.id === segmentId)
      const left = track.children[index]
      if (!Number.isFinite(timelineMs) || timelineMs <= left.startTime || timelineMs >= left.endTime)
        return false

      const hasSegmentId = (id: string) => protocol.tracks.some(t => t.children.some(s => s.id === id))
      rightId = options?.idFactory?.segment?.() ?? genRandomId()
      while (hasSegmentId(rightId))
        rightId = options?.idFactory?.segment?.() ?? genRandomId()

      // Deep-clone via JSON: `left` is an immer draft, not a structured-cloneable target.
      const right = JSON.parse(JSON.stringify(left)) as SegmentUnion
      right.id = rightId
      right.startTime = timelineMs
      right.endTime = left.endTime
      left.endTime = timelineMs

      // Timeline deltas map to source time scaled by playRate (evaluator sourceMs formula).
      if (isSegmentWithFromTime(left) && isSegmentWithFromTime(right)) {
        const playRate = normalizeSegmentPlayRate(left)
        right.fromTime = Math.max(0, (left.fromTime ?? 0) + (timelineMs - left.startTime) * playRate)
      }

      // A split must be audibly seamless: fade-in stays on the left half,
      // fade-out on the right, both clamped to their half's duration.
      if (isAudioSegment(left) && isAudioSegment(right)) {
        const leftDuration = left.endTime - left.startTime
        const rightDuration = right.endTime - right.startTime
        delete left.fadeOutDuration
        delete right.fadeInDuration
        if (typeof left.fadeInDuration === 'number')
          left.fadeInDuration = Math.min(left.fadeInDuration, leftDuration / 2)
        if (typeof right.fadeOutDuration === 'number')
          right.fadeOutDuration = Math.min(right.fadeOutDuration, rightDuration / 2)
      }

      // Rebase keyframes (RFC 0002 §3.7): the left half keeps frames before
      // the cut, the right half keeps the rest shifted by -offset; both gain
      // a boundary keyframe sampled at the cut so the result stays seamless.
      if (left.keyframes?.length) {
        const offsetMs = timelineMs - left.startTime
        right.keyframes = (right.keyframes ?? []).map(track => ({
          property: track.property,
          frames: [
            { timeMs: 0, value: sampleKeyframes(track, offsetMs) },
            ...track.frames
              .filter(frame => frame.timeMs > offsetMs)
              .map(frame => ({ ...frame, timeMs: frame.timeMs - offsetMs })),
          ],
        }))
        left.keyframes = left.keyframes.map(track => ({
          property: track.property,
          frames: [
            ...track.frames.filter(frame => frame.timeMs < offsetMs),
            { timeMs: offsetMs, value: sampleKeyframes(track, offsetMs) },
          ],
        }))
      }

      try {
        validator.verifySegment(JSON.parse(JSON.stringify(left)))
        validator.verifySegment(JSON.parse(JSON.stringify(right)))
      }
      catch {
        throw new Error('invalid segment data')
      }

      // Both halves tile the original span exactly, so the main-track
      // no-gap invariant is preserved by construction.
      ;(track.children as SegmentUnion[]).splice(index + 1, 0, right)

      // Re-point outgoing transition edges to the right half before the
      // transition sync garbage-collects the now non-adjacent pair.
      for (const edge of protocol.transitions ?? []) {
        if (edge.fromSegmentId === segmentId)
          edge.fromSegmentId = rightId
      }

      affectedTrackId = track.trackId
      return true
    })

    const affectedSegments: SegmentUnion[] = []
    if (success && affectedTrackId) {
      const currentProtocol = exportProtocol()
      const track = currentProtocol.tracks.find(t => t.trackId === affectedTrackId)
      if (track)
        affectedSegments.push(...cloneAffectedSegments(track.children))
    }

    return {
      success,
      leftId: success ? segmentId : '',
      rightId: success ? rightId : '',
      affectedSegments,
    }
  }

  function updateSegment<T extends ITrackType>(updater: (segment: TrackTypeMapSegment[T]) => void, id?: string, type?: T) {
    updateProtocol((protocol) => {
      const _id = id ?? selectedSegment.value?.id
      if (_id === undefined)
        return
      const segment = getTrackBySegmentId(_id, protocol)
      if (segment && (!type || segment.segmentType === type))
        // @ts-expect-error type is correct
        updater(segment)
    }, (patches, inversePatches, effect) => {
      effect((draft) => {
        // verify all modified segments
        if (checkSegment(patches, inversePatches, draft, validator)) {
          handleSegmentUpdate(patches, inversePatches, draft, undoHistory)
        }
        else {
          // rollback all changes
          undoHistory()
        }
      })
    })
  }

  const addTransition = (transition: ITransition, addTime?: number) => {
    return updateProtocolWithTransitionSync((protocol) => {
      const mainTrack = getMainFramesTrack(protocol)
      if (!mainTrack || mainTrack.children.length < 2)
        return false

      const insertTime = Math.max(0, addTime ?? curTime.value)
      let startSegmentIdx = findInsertFramesSegmentIndex(mainTrack.children, insertTime) - 1

      // cross first segment left half time, or
      // cross last segment right half time
      startSegmentIdx = Math.min(Math.max(0, startSegmentIdx), mainTrack.children.length - 2)

      // Validate transition object before applying
      // Transition requires: id (string), name (string), duration (number >= 0)
      if (!transition || typeof transition !== 'object'
        || typeof transition.id !== 'string'
        || typeof transition.name !== 'string'
        || typeof transition.duration !== 'number'
        || transition.duration < 0) {
        // Invalid transition, return true but don't modify segments
        return true
      }

      // update transition - modify both segments in a single atomic operation
      const segment1 = mainTrack.children[startSegmentIdx] as TrackTypeMapSegment['frames']
      const segment2 = mainTrack.children[startSegmentIdx + 1] as TrackTypeMapSegment['frames']

      const transitions = Array.isArray(protocol.transitions)
        ? protocol.transitions
        : []
      if (!Array.isArray(protocol.transitions))
        protocol.transitions = transitions

      const edge: ITransitionEdge = {
        id: transition.id,
        name: transition.name,
        duration: transition.duration,
        fromSegmentId: segment1.id,
        toSegmentId: segment2.id,
      }
      const edgeIdx = transitions.findIndex(item =>
        item.fromSegmentId === edge.fromSegmentId
        && item.toSegmentId === edge.toSegmentId,
      )
      if (edgeIdx >= 0)
        transitions[edgeIdx] = edge
      else
        transitions.push(edge)

      return true
    })
  }

  const removeTransition = (segmentId: string) => {
    return updateProtocolWithTransitionSync((protocol) => {
      const mainTrack = getMainFramesTrack(protocol)
      if (!mainTrack)
        return false

      const hasSegment = mainTrack.children.some(segment => segment.id === segmentId)
      if (!hasSegment)
        return false

      const transitions = Array.isArray(protocol.transitions)
        ? protocol.transitions
        : []
      const filtered = transitions.filter(edge =>
        edge.fromSegmentId !== segmentId
        && edge.toSegmentId !== segmentId,
      )
      if (filtered.length === transitions.length)
        return false
      protocol.transitions = filtered
      return true
    })
  }

  const updateTransition = (segmentId: string, updater: (transition: ITransition) => void) => {
    return updateProtocolWithTransitionSync((protocol) => {
      const mainTrack = getMainFramesTrack(protocol)
      if (!mainTrack)
        return false
      const hasSegment = mainTrack.children.some(segment => segment.id === segmentId)
      if (!hasSegment)
        return false

      const transitions = Array.isArray(protocol.transitions)
        ? protocol.transitions
        : []
      const edge = transitions.find(item => item.fromSegmentId === segmentId)
        ?? transitions.find(item => item.toSegmentId === segmentId)
      if (edge) {
        const nextTransition: ITransition = {
          id: edge.id,
          name: edge.name,
          duration: edge.duration,
        }
        updater(nextTransition)
        if (!isValidTransitionData(nextTransition))
          throw new Error('invalid transition data')
        edge.id = nextTransition.id
        edge.name = nextTransition.name
        edge.duration = nextTransition.duration
        return true
      }

      return false
    })
  }

  const replaceTrackId = (oldTrackId: string, newTrackId: string) => {
    return updateProtocolWithTransitionSync((protocol) => {
      const track = protocol.tracks.find(t => t.trackId === oldTrackId)
      if (!track)
        return false
      track.trackId = newTrackId
      return true
    })
  }

  const replaceSegmentId = (oldSegmentId: string, newSegmentId: string) => {
    if (oldSegmentId === newSegmentId)
      return true
    const success = updateProtocolWithTransitionSync((protocol) => {
      for (const track of protocol.tracks) {
        if (track.children.some(segment => segment.id === newSegmentId))
          return false
      }
      for (const track of protocol.tracks) {
        const segment = track.children.find(item => item.id === oldSegmentId)
        if (!segment)
          continue
        segment.id = newSegmentId
        for (const edge of protocol.transitions ?? []) {
          if (edge.fromSegmentId === oldSegmentId)
            edge.fromSegmentId = newSegmentId
          if (edge.toSegmentId === oldSegmentId)
            edge.toSegmentId = newSegmentId
        }
        return true
      }
      return false
    })
    if (success && selectedSegmentId.value === oldSegmentId)
      selectedSegmentId.value = newSegmentId
    return success
  }

  type HistoryMutationResult = {
    success: boolean
    affectedSegments: SegmentUnion[]
    affectedTracks: TrackUnion[]
    createdTracks: TrackUnion[]
    removedTrackIds: string[]
    removedSegmentIds: string[]
  }

  const emptyHistoryResult: HistoryMutationResult = {
    success: false,
    affectedSegments: [],
    affectedTracks: [],
    createdTracks: [],
    removedTrackIds: [],
    removedSegmentIds: [],
  }

  const takeSnapshot = () => snapshotProtocolState(clone(toRaw(protocolRef.value)) as IVideoProtocol)

  const undo = (): HistoryMutationResult => {
    if (undoCount.value <= 0)
      return emptyHistoryResult
    const prev = takeSnapshot()
    undoHistory()
    const next = takeSnapshot()
    const diff = diffProtocolSnapshots(prev, next)
    return {
      success: true,
      affectedSegments: diff.affectedSegments,
      affectedTracks: diff.affectedTracks,
      createdTracks: diff.addedTracks,
      removedTrackIds: diff.removedTrackIds,
      removedSegmentIds: diff.removedSegmentIds,
    }
  }

  const redo = (): HistoryMutationResult => {
    if (redoCount.value <= 0)
      return emptyHistoryResult
    const prev = takeSnapshot()
    redoHistory()
    const next = takeSnapshot()
    const diff = diffProtocolSnapshots(prev, next)
    return {
      success: true,
      affectedSegments: diff.affectedSegments,
      affectedTracks: diff.affectedTracks,
      createdTracks: diff.addedTracks,
      removedTrackIds: diff.removedTrackIds,
      removedSegmentIds: diff.removedSegmentIds,
    }
  }

  return {
    videoBasicInfo,
    curTime,
    setSelectedSegment,
    selectedSegment,
    trackMap: tracks,
    segmentMap: segments,
    protocol: protocolRef,
    getSegment,
    addSegment,
    removeSegment,
    updateSegment,
    moveSegment,
    resizeSegment,
    splitSegment,
    exportProtocol,
    addTransition,
    removeTransition,
    updateTransition,
    replaceTrackId,
    replaceSegmentId,

    undo,
    redo,
    redoCount,
    undoCount,
  }
}

function normalizedProtocol(protocol: IVideoProtocol) {
  const normalized = normalizeProtocolTracks(clone(protocol))
  normalizeProtocolTransitions(normalized)
  const { state: protocolState, update: updateProtocol, enable, redo, undo, undoCount, redoCount } = useHistory(normalized)
  enable()

  const videoBasicInfo = reactive({
    // version is readonly
    version: computed(() => protocolState.value.version),
    width: protocolState.value.width,
    height: protocolState.value.height,
    fps: protocolState.value.fps,
  })

  const protocolRef = computed(() => protocolState.value)

  const segments = computed(() => {
    const map: Record<string, DeepReadonly<SegmentUnion | undefined>> = {}
    for (const track of protocolState.value.tracks) {
      for (const segment of track.children)
        map[segment.id] = readonly(segment)
    }

    return map
  })

  const tracks = computed(() => {
    const map: { [K in keyof TrackTypeMapTrack]: DeepReadonly<TrackTypeMapTrack[K][]>; } = {} as any
    for (const track of protocolState.value.tracks) {
      if (!map[track.trackType])
        map[track.trackType] = [];
      (map[track.trackType] as TrackTypeMapTrack[ITrackType][]).push(track)
    }
    return map
  })

  const exportProtocol = () => {
    updateProtocol((protocol) => {
      protocol.version = videoBasicInfo.version
      protocol.width = videoBasicInfo.width
      protocol.height = videoBasicInfo.height
      protocol.fps = videoBasicInfo.fps
    })
    return toRaw(protocolState.value)
  }

  return {
    videoBasicInfo,
    updateProtocol,
    protocol: protocolRef,
    segments,
    tracks,
    redo,
    undo,
    undoCount,
    redoCount,
    exportProtocol,
  }
}

function normalizeProtocolTracks(protocol: IVideoProtocol) {
  for (const track of protocol.tracks) {
    track.children.sort((a, b) => {
      if (a.startTime === b.startTime) {
        if (a.endTime === b.endTime)
          return a.id.localeCompare(b.id)
        return a.endTime - b.endTime
      }
      return a.startTime - b.startTime
    })
  }
  return protocol
}

function getTrackBySegmentId(segmentId: string, protocol: IVideoProtocol) {
  for (const track of protocol.tracks) {
    const segment = track.children.find(segment => segment.id === segmentId)
    if (segment)
      return segment
  }
  return undefined
}
