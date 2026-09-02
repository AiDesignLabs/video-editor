import type { IAudioSegment, ITrack, ITrackType, ITransition, ITransitionEdge, IVideoFramesSegment, IVideoProtocol, SegmentUnion, TrackTypeMapSegment, TrackTypeMapTrack, TrackUnion } from '@video-editor/shared'
import type { DeepReadonly } from '@vue/reactivity'
import type { Patch } from 'immer'
import type { PartialByKeys } from './utils'
import { isAudioSegment, isVideoFramesSegment, sampleKeyframes } from '@video-editor/shared'
import { computed, reactive, readonly, ref, toRaw } from '@vue/reactivity'
import { createValidator } from '../verify'
import { MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, MIN_FPS } from '../verify/rules'
import { useHistory } from './immer'
import { checkSegment, handleSegmentUpdate } from './segment'
import { clone, findInsertFramesSegmentIndex, findInsertSegmentIndex, genRandomId } from './utils'

export type {
  TransactionHandle,
  TransactionMeta,
  TransactionOptions,
  TransactionResult,
  TransactionStatus,
  UndoStackItem,
} from './immer'

function cloneAffectedSegments(segments: SegmentUnion | SegmentUnion[]) {
  const toPlain = (segment: SegmentUnion) => JSON.parse(JSON.stringify(toRaw(segment))) as SegmentUnion
  return Array.isArray(segments)
    ? segments.map(segment => toPlain(segment))
    : [toPlain(segments)]
}

function cloneTrack(track: TrackUnion): TrackUnion {
  return JSON.parse(JSON.stringify(toRaw(track))) as TrackUnion
}

interface ProtocolSnapshot {
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

/**
 * Re-exported from the schema rules: the canvas bounds are enforced by the
 * protocol schema itself, so writing the protocol directly cannot bypass them.
 * `setCanvasSize` only exists to turn a rejection into a readable message
 * instead of a thrown validation error.
 */
export { MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, MIN_FPS }

export interface CanvasSize {
  width: number
  height: number
}

export interface SetFpsResult {
  success: boolean
  /** Present when the frame rate was rejected; the project is left untouched. */
  error?: string
}

export interface SetCanvasSizeResult {
  success: boolean
  /** Present when the size was rejected; the canvas is left untouched. */
  error?: string
}

export interface AddTrackOptions {
  trackType: ITrackType
  /** Generated when omitted. Explicit ids must be non-empty and unique. */
  trackId?: string
  /** Final zero-based position. Defaults to the first track. */
  index?: number
}

export interface AddTrackResult {
  success: boolean
  trackId?: string
  error?: string
}

export interface TrackStructureResult {
  success: boolean
  error?: string
  /** Segments deleted together with a removed track. */
  removedSegmentIds?: string[]
}

const TRACK_TYPES = new Set<ITrackType>(['frames', 'text', 'sticker', 'audio', 'effect', 'filter'])

function validateCanvasDimension(label: string, value: number): string | null {
  if (!Number.isFinite(value))
    return `${label} must be a finite number`
  if (!Number.isInteger(value))
    return `${label} must be a whole number of pixels, received ${value}`
  if (value < MIN_CANVAS_SIZE)
    return `${label} must be at least ${MIN_CANVAS_SIZE}, received ${value}`
  if (value > MAX_CANVAS_SIZE)
    return `${label} must be at most ${MAX_CANVAS_SIZE}, received ${value}`
  return null
}

function validateFps(value: number): string | null {
  if (!Number.isFinite(value))
    return 'fps must be a finite number'
  if (value < MIN_FPS)
    return `fps must be at least ${MIN_FPS}, received ${value}`
  return null
}

/** The subset of track fields that `updateTrack` is allowed to change. */
export interface TrackMutableFields {
  /** Skip the track's visual output. */
  hidden?: boolean
  /** Skip the track's audio output. */
  muted?: boolean
  /** Consumer-defined track metadata. */
  extra?: TrackUnion['extra']
}

/**
 * What `undo()`/`redo()` report back. Exported because it is part of the
 * manager's public return type: leaving it local made the emitted `.d.ts`
 * reference a private name, which broke the rollup for downstream consumers.
 */
export interface HistoryMutationResult {
  success: boolean
  affectedSegments: SegmentUnion[]
  affectedTracks: TrackUnion[]
  createdTracks: TrackUnion[]
  removedTrackIds: string[]
  removedSegmentIds: string[]
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
    beginTransaction,
    transaction,
    isTransactionActive,
    transactionDepth,
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

  /**
   * Runs a command and keeps the transition edges consistent with the tracks.
   *
   * An updater that returns `false` means the command refused, and must leave
   * no trace. That needs a transaction: the transition sync below runs even
   * when the updater bailed out, and its write to `protocol.transitions` was by
   * itself enough to push a history item for an operation that changed nothing.
   */
  const updateProtocolWithTransitionSync = <T>(updater: (protocol: IVideoProtocol) => T): T => {
    const tx = beginTransaction()
    let result!: T
    updateProtocol((protocol) => {
      result = updater(protocol)
      syncProtocolTransitionEdges(protocol)
    })
    if ((result as unknown) === false)
      tx.cancel()
    else
      tx.commit()
    return result
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

  /**
   * Duplicate an existing segment and place the copy at the current playhead.
   *
   * The copy keeps every property of the source (keyframes included - they are
   * segment-relative) except its id, which is regenerated. Transitions are not
   * duplicated: edges are keyed by segment id and the transition sync drops any
   * edge that is no longer between two adjacent main-track segments.
   *
   * Placement reuses `addSegment`, so the whole duplication is a single history
   * entry.
   */
  const duplicateSegment = (segmentId: string): {
    success: boolean
    id: string
    affectedSegments: SegmentUnion[]
    affectedTracks: TrackUnion[]
    createdTracks: TrackUnion[]
    removedTrackIds: string[]
  } => {
    // Read from the exported (plain) state, never from an immer draft.
    const currentProtocol = exportProtocol()
    let source: SegmentUnion | undefined
    for (const track of currentProtocol.tracks) {
      const found = track.children.find(segment => segment.id === segmentId)
      if (found) {
        source = found
        break
      }
    }

    if (!source)
      return { success: false, id: '', affectedSegments: [], affectedTracks: [], createdTracks: [], removedTrackIds: [] }

    // Keep the source id on the copy on purpose: `normalizedSegment` detects the
    // collision and generates a fresh id for us.
    const copy = JSON.parse(JSON.stringify(source)) as SegmentUnion
    const result = addSegment(copy)

    return { success: true, ...result }
  }

  const removeSegment = (id: SegmentUnion['id'], removeOptions?: { ripple?: boolean }): {
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
          const removedStartTime = track.children[index].startTime
          const removedDuration = track.children[index].endTime - track.children[index].startTime
          track.children.splice(index, 1)

          // If track still has segments and it's a main frames track, rebuild timeline
          if (track.children.length > 0) {
            const isMainFramesTrack = track.trackType === 'frames' && (track as TrackTypeMapTrack['frames']).isMain
            if (isMainFramesTrack) {
              // The main frames track always ripples (no gaps allowed), so the
              // `ripple` option is meaningless there and is ignored.
              rebuildTrackTimeline(track, 0)
              // All remaining segments may be affected
              affectedTrackId = track.trackId
            }
            else if (removeOptions?.ripple && removedDuration > 0) {
              // Ripple delete on a gap-allowing track: pull every following
              // segment left by the removed duration. A segment is clamped at 0
              // when the shift would push it negative, which can shrink a gap
              // that existed before the delete - an accepted edge case.
              for (const segment of track.children) {
                if (segment.startTime < removedStartTime)
                  continue
                const shift = Math.min(removedDuration, segment.startTime)
                if (shift <= 0)
                  continue
                segment.startTime -= shift
                segment.endTime -= shift
              }
              // Re-sort and fix any overlap the clamping may have introduced.
              rebuildTrackTimeline(track, 0)
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

      // Creating a track without saying where to put it has no defined result,
      // and used to drop the segment on the floor while reporting success.
      if (moveOptions.isNewTrack === true && moveOptions.newTrackInsertIndex === undefined)
        return false

      // An omitted target means "stay on this track". Without the fallback the
      // segment was removed from the source track and never re-added anywhere.
      const targetTrackId = moveOptions.targetTrackId ?? moveOptions.sourceTrackId

      // Check if moving within same track (same trackId and not creating new track)
      const isSameTrack = targetTrackId === moveOptions.sourceTrackId && moveOptions.isNewTrack !== true

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
        else {
          // Add to existing target track
          const targetTrack = protocol.tracks.find(t => t.trackId === targetTrackId)
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
      const nextEndTime = options.endTime
      let nextDuration = nextEndTime - nextStartTime
      if (!Number.isFinite(nextDuration) || nextDuration < 0)
        return false

      const segmentWithFromTime = isSegmentWithFromTime(segment) ? segment : null
      let nextFromTime = segmentWithFromTime ? (segmentWithFromTime.fromTime ?? 0) : 0

      // When resizing the start edge, keep the media content aligned by updating fromTime.
      // - Trimming in (startTime increases) => fromTime increases
      // - Extending left (startTime decreases) => fromTime decreases (clamped at 0)
      // Reversed segments consume their source window from its END, so trimming
      // the start edge shortens the window tail instead of moving `fromTime`.
      // `fromTime` stays put and the shorter duration shrinks the span implicitly.
      const remapsFromTimeOnStartEdge = segmentWithFromTime !== null && segmentWithFromTime.reversed !== true

      if (segmentWithFromTime && remapsFromTimeOnStartEdge && nextStartTime !== originalStartTime) {
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
        const originalFromTime = left.fromTime ?? 0
        const cutSourceMs = (timelineMs - left.startTime) * playRate
        if (left.reversed === true) {
          // A reversed segment reads [fromTime, fromTime + span] backwards, so the
          // LEFT half plays the tail of the window and the RIGHT half its head.
          // right.endTime still holds the original endTime here.
          const originalSpanMs = (right.endTime - left.startTime) * playRate
          left.fromTime = Math.max(0, originalFromTime + originalSpanMs - cutSourceMs)
          right.fromTime = Math.max(0, originalFromTime)
        }
        else {
          right.fromTime = Math.max(0, originalFromTime + cutSourceMs)
        }
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

  /**
   * Returns whether the edit was kept. A rejected edit leaves no trace, so a
   * caller batching several of them can tell one was dropped instead of
   * assuming they all landed.
   */
  function updateSegment<T extends ITrackType>(updater: (segment: TrackTypeMapSegment[T]) => void, id?: string, type?: T): boolean {
    const segmentId = id ?? selectedSegment.value?.id

    // The edit and the ripple it causes on later segments belong to one undo
    // step, and a rejected edit must leave no trace at all. Both are the
    // transaction's job: rolling back used to mean calling `undo()` from
    // inside the update callback, which popped whatever happened to be on top
    // of the stack.
    const tx = beginTransaction({ label: 'update-segment', data: { segmentId } })

    let patches: Patch[] = []
    let inversePatches: Patch[] = []
    updateProtocol((protocol) => {
      if (segmentId === undefined)
        return
      const segment = getTrackBySegmentId(segmentId, protocol)
      if (segment && (!type || segment.segmentType === type))
        // @ts-expect-error type is correct
        updater(segment)
    }, (nextPatches, nextInversePatches) => {
      patches = nextPatches
      inversePatches = nextInversePatches
    })

    if (!patches.length) {
      tx.commit()
      return true
    }

    let valid = true
    updateProtocol((draft) => {
      // verify all modified segments
      if (checkSegment(patches, inversePatches, draft, validator)) {
        handleSegmentUpdate(patches, inversePatches, draft, () => {
          valid = false
        })
      }
      else {
        valid = false
      }
    })

    if (valid) {
      tx.commit()
      return true
    }
    tx.cancel()
    return false
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

  /** Set the project frame rate without changing millisecond-based timeline data. */
  const setFps = (fps: number): SetFpsResult => {
    const error = validateFps(fps)
    if (error)
      return { success: false, error }

    if (protocolRef.value.fps === fps)
      return { success: true }

    updateProtocol((protocol) => {
      protocol.fps = fps
    })
    return { success: true }
  }

  /**
   * Update the mutable presentation fields of a track (`hidden`, `muted`, `extra`).
   *
   * The updater receives a detached patch object, never the draft track, so the
   * structural fields (`trackId`, `trackType`, `children`, `isMain`) cannot be
   * changed through this command. Use `replaceTrackId` / segment commands for those.
   */
  /**
   * Resize the project canvas.
   *
   * Segment transforms are normalised (position/scale are relative to the
   * canvas), so nothing else has to move — how a segment fills the new canvas
   * stays a `fillMode` decision. Invalid input is reported rather than clamped,
   * so a typo cannot silently reshape the project.
   */
  const setCanvasSize = ({ width, height }: CanvasSize): SetCanvasSizeResult => {
    const error = validateCanvasDimension('width', width) ?? validateCanvasDimension('height', height)
    if (error)
      return { success: false, error }

    // A no-op must not land on the undo stack.
    if (protocolRef.value.width === width && protocolRef.value.height === height)
      return { success: true }

    updateProtocol((protocol) => {
      protocol.width = width
      protocol.height = height
    })
    return { success: true }
  }

  /** Add an empty track without exposing the protocol draft to callers. */
  const addTrack = (input: AddTrackOptions): AddTrackResult => {
    if (!TRACK_TYPES.has(input.trackType))
      return { success: false, error: `unsupported track type ${String(input.trackType)}` }
    if (input.trackId !== undefined && (typeof input.trackId !== 'string' || input.trackId.length === 0))
      return { success: false, error: 'track id must not be empty' }

    const trackId = input.trackId ?? options?.idFactory?.track?.() ?? genRandomId()
    if (typeof trackId !== 'string' || trackId.length === 0)
      return { success: false, error: 'track id must not be empty' }
    const tracks = protocolRef.value.tracks
    if (tracks.some(track => track.trackId === trackId))
      return { success: false, error: `track id ${trackId} already exists` }

    const index = input.index ?? 0
    if (!Number.isInteger(index) || index < 0 || index > tracks.length)
      return { success: false, error: `track index must be between 0 and ${tracks.length}` }

    const isMain = input.trackType === 'frames' && !getMainFramesTrack(protocolRef.value)
    const track = {
      trackId,
      trackType: input.trackType,
      children: [],
      ...(isMain ? { isMain: true } : {}),
    } as TrackUnion

    try {
      validator.verifyTrack(track)
    }
    catch {
      return { success: false, error: 'invalid track data' }
    }

    updateProtocol((protocol) => {
      protocol.tracks.splice(index, 0, track)
    })
    return { success: true, trackId }
  }

  /** Remove a track and all of its segments as one history entry. */
  const removeTrack = (trackId: string): TrackStructureResult => {
    const track = protocolRef.value.tracks.find(item => item.trackId === trackId)
    if (!track)
      return { success: false, error: `no track with id ${trackId}` }

    const removedSegmentIds = track.children.map(segment => segment.id)
    const removedMainFrames = track.trackType === 'frames' && Boolean(track.isMain)

    updateProtocolWithTransitionSync((protocol) => {
      const index = protocol.tracks.findIndex(item => item.trackId === trackId)
      protocol.tracks.splice(index, 1)

      if (removedMainFrames) {
        for (let i = protocol.tracks.length - 1; i >= 0; i--) {
          const candidate = protocol.tracks[i]
          if (candidate.trackType !== 'frames')
            continue
          candidate.isMain = true
          rebuildTrackTimeline(candidate, 0)
          break
        }
      }
      return true
    })

    return { success: true, removedSegmentIds }
  }

  /** Move a track to its final zero-based position. */
  const moveTrack = (trackId: string, toIndex: number): TrackStructureResult => {
    const tracks = protocolRef.value.tracks
    const fromIndex = tracks.findIndex(track => track.trackId === trackId)
    if (fromIndex < 0)
      return { success: false, error: `no track with id ${trackId}` }
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= tracks.length)
      return { success: false, error: `track index must be between 0 and ${Math.max(0, tracks.length - 1)}` }
    if (fromIndex === toIndex)
      return { success: true }

    updateProtocol((protocol) => {
      const [track] = protocol.tracks.splice(fromIndex, 1)
      protocol.tracks.splice(toIndex, 0, track)
    })
    return { success: true }
  }

  const updateTrack = (trackId: string, updater: (track: TrackMutableFields) => void): boolean => {
    return updateProtocolWithTransitionSync((protocol) => {
      const track = protocol.tracks.find(t => t.trackId === trackId)
      if (!track)
        return false

      const patch: TrackMutableFields = {
        hidden: track.hidden,
        muted: track.muted,
        extra: track.extra === undefined || track.extra === null
          ? track.extra
          : JSON.parse(JSON.stringify(track.extra)) as TrackUnion['extra'],
      }
      updater(patch)

      if (patch.hidden === undefined)
        delete track.hidden
      else
        track.hidden = patch.hidden

      if (patch.muted === undefined)
        delete track.muted
      else
        track.muted = patch.muted

      const extraTarget = track as { extra?: TrackUnion['extra'] }
      if (patch.extra === undefined)
        delete extraTarget.extra
      else
        extraTarget.extra = patch.extra

      return true
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
    // Undoing into a half-applied transaction would desync the transaction's
    // snapshot from the state it is about to commit.
    if (isTransactionActive.value || undoCount.value <= 0)
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
    if (isTransactionActive.value || redoCount.value <= 0)
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
    duplicateSegment,
    updateSegment,
    moveSegment,
    resizeSegment,
    splitSegment,
    exportProtocol,
    addTransition,
    removeTransition,
    updateTransition,
    addTrack,
    removeTrack,
    moveTrack,
    updateTrack,
    setCanvasSize,
    setFps,
    replaceTrackId,
    replaceSegmentId,

    undo,
    redo,
    redoCount,
    undoCount,

    beginTransaction,
    transaction,
    isTransactionActive,
    transactionDepth,
  }
}

function normalizedProtocol(protocol: IVideoProtocol) {
  const normalized = normalizeProtocolTracks(clone(protocol))
  normalizeProtocolTransitions(normalized)
  const {
    state: protocolState,
    update: updateProtocol,
    enable,
    redo,
    undo,
    undoCount,
    redoCount,
    beginTransaction,
    transaction,
    isTransactionActive,
    transactionDepth,
  } = useHistory(normalized)
  enable()

  /**
   * Writable view over the protocol's basic info.
   *
   * These used to be plain snapshots taken at construction, which left two
   * sources of truth: `updateProtocol` (what undo/redo restores) and this
   * object (what `exportProtocol` used to write back). A canvas resize made
   * that split visible — history would restore one and export would clobber it
   * with the other. They are writable computeds now, so a read always reflects
   * the protocol and a write goes through history like any other edit.
   */
  const videoBasicInfo = reactive({
    // version is readonly
    version: computed(() => protocolState.value.version),
    width: computed({
      get: () => protocolState.value.width,
      set: (value: number) => {
        updateProtocol((protocol) => {
          protocol.width = value
        })
      },
    }),
    height: computed({
      get: () => protocolState.value.height,
      set: (value: number) => {
        updateProtocol((protocol) => {
          protocol.height = value
        })
      },
    }),
    fps: computed({
      get: () => protocolState.value.fps,
      set: (value: number) => {
        updateProtocol((protocol) => {
          protocol.fps = value
        })
      },
    }),
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

  // No write-back needed: `videoBasicInfo` now reads straight from the protocol.
  const exportProtocol = () => toRaw(protocolState.value)

  return {
    videoBasicInfo,
    updateProtocol,
    beginTransaction,
    transaction,
    isTransactionActive,
    transactionDepth,
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
