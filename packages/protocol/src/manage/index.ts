import type { ITrack, ITrackType, ITransition, IVideoProtocol, SegmentUnion, TrackTypeMapSegment, TrackTypeMapTrack, TrackUnion } from '@video-editor/shared'
import type { DeepReadonly } from '@vue/reactivity'
import type { PartialByKeys } from './utils'
import { computed, reactive, readonly, ref, toRaw } from '@vue/reactivity'
import { createValidator } from '../verify'
import { useHistory } from './immer'
import { checkSegment, handleSegmentUpdate } from './segment'
import { clone, findInsertFramesSegmentIndex, findInsertSegmentIndex, genRandomId } from './utils'

export function createVideoProtocolManager(protocol: IVideoProtocol) {
  const validator = createValidator()

  const { videoBasicInfo, segments, tracks, updateProtocol, undo, redo, exportProtocol, undoCount, redoCount } = normalizedProtocol(validator.verify(protocol))

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

  const addSegmentToTrack = <T extends SegmentUnion>(segment: T, tracks: IVideoProtocol['tracks']) => {
    const track = {
      isMain: segment.segmentType === 'frames' && !(tracks?.length) ? true : undefined,
      trackType: segment.segmentType,
      trackId: genRandomId(),
      children: [segment],
    } satisfies ITrack<ITrackType> as TrackUnion
    tracks.push(track)
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

    return framesSegment.id
  }

  const addFramesSegment = (framesSegment: TrackTypeMapSegment['frames'], track: TrackTypeMapTrack['frames']) => {
    return insertFramesSegmentIntoTrack(framesSegment, track, curTime.value)
  }

  /**
   * Rebuild track timeline from a specific segment index
   * - Main frames track: ensures no gaps (continuous timeline)
   * - Other tracks (including non-main frames): allows gaps but prevents overlaps
   */
  const rebuildTrackTimeline = (track: TrackUnion, fromIndex = 0) => {
    const children = track.children as SegmentUnion[]

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
      _segment.id = genRandomId()

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

  const addSegment = (segment: PartialByKeys<TrackTypeMapSegment[ITrackType], 'id'>) => {
    const theSegment = normalizedSegment(segment)

    try {
      validator.verifySegment(theSegment)
    }
    catch {
      throw new Error('invalid segment data')
    }

    return updateProtocol((protocol) => {
      if (theSegment.segmentType === 'frames') {
        const frameTracks = protocol.tracks.filter(track => track.trackType === 'frames') as TrackTypeMapTrack['frames'][]
        const mainTrack = frameTracks.find(track => track.isMain)
        if (!mainTrack)
          return addSegmentToTrack(theSegment, protocol.tracks)

        return addFramesSegment(theSegment, mainTrack)
      }

      const tracks = protocol.tracks
      for (let i = tracks.length - 1; i >= 0; i--) {
        if (tracks[i].trackType !== theSegment.segmentType)
          continue
        const children = tracks[i].children as SegmentUnion[]
        const index = findInsertSegmentIndex(theSegment, children, curTime.value)
        if (index !== -1) {
          children.splice(index, 0, theSegment)
          return theSegment.id
        }
      }

      return addSegmentToTrack(theSegment, tracks)
    })
  }

  const removeSegment = (id: SegmentUnion['id']) => {
    return updateProtocol((protocol) => {
      for (let i = 0; i < protocol.tracks.length; i++) {
        const track = protocol.tracks[i]
        const index = track.children.findIndex(segment => segment.id === id)
        if (index !== -1) {
          track.children.splice(index, 1)
          if (track.children.length === 0)
            protocol.tracks.splice(i, 1)
          return true
        }
      }
      return false
    })
  }

  const moveSegment = (options: {
    segmentId: string
    sourceTrackId: string
    targetTrackId?: string
    startTime: number
    endTime: number
    isNewTrack?: boolean
    newTrackInsertIndex?: number
  }) => {
    return updateProtocol((protocol) => {
      // Find source track and segment
      const sourceTrack = protocol.tracks.find(t => t.trackId === options.sourceTrackId)
      if (!sourceTrack)
        return false

      const segmentIndex = sourceTrack.children.findIndex(seg => seg.id === options.segmentId)
      if (segmentIndex < 0)
        return false

      const segment = sourceTrack.children[segmentIndex] as SegmentUnion

      // Check if moving within same track (same trackId and not creating new track)
      const isSameTrack = options.targetTrackId === options.sourceTrackId && options.isNewTrack !== true

      if (isSameTrack) {
        // Moving within same track - just update time and rebuild to avoid overlaps
        segment.startTime = options.startTime
        segment.endTime = options.endTime
        rebuildTrackTimeline(sourceTrack)
      }
      else {
        // Moving to different track or creating new track
        // Step 1: Remove from source track
        sourceTrack.children.splice(segmentIndex, 1)

        // Step 2: Rebuild source track timeline to avoid overlaps
        if (sourceTrack.children.length > 0) {
          rebuildTrackTimeline(sourceTrack)
        }

        // Step 3: Delete source track if empty
        if (sourceTrack.children.length === 0) {
          const trackIdx = protocol.tracks.findIndex(t => t.trackId === sourceTrack.trackId)
          if (trackIdx >= 0) {
            protocol.tracks.splice(trackIdx, 1)
          }
        }

        // Step 4: Update segment time
        segment.startTime = options.startTime
        segment.endTime = options.endTime

        // Step 5: Add to target track or create new track
        if (options.isNewTrack && options.newTrackInsertIndex !== undefined) {
          // Create new track
          const isFirstFramesTrack = segment.segmentType === 'frames'
            && !protocol.tracks.some(t => t.trackType === 'frames' && (t as any).isMain)

          const newTrack: TrackUnion = {
            trackId: genRandomId(),
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

          protocol.tracks.splice(options.newTrackInsertIndex, 0, newTrack)
        }
        else if (options.targetTrackId) {
          // Add to existing target track
          const targetTrack = protocol.tracks.find(t => t.trackId === options.targetTrackId)
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
        }
      }

      return true
    })
  }

  const resizeSegment = (options: {
    segmentId: string
    trackId: string
    startTime: number
    endTime: number
  }) => {
    return updateProtocol((protocol) => {
      const track = protocol.tracks.find(t => t.trackId === options.trackId)
      if (!track)
        return false

      const segmentIndex = track.children.findIndex(seg => seg.id === options.segmentId)
      if (segmentIndex < 0)
        return false

      const segment = track.children[segmentIndex] as SegmentUnion

      // Update segment time
      segment.startTime = options.startTime
      segment.endTime = options.endTime

      // Rebuild timeline from current segment onwards to avoid overlaps
      rebuildTrackTimeline(track, segmentIndex)

      return true
    })
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
          handleSegmentUpdate(patches, inversePatches, draft, undo)
        }
        else {
          // rollback all changes
          undo()
        }
      })
    })
  }

  const addTransition = (transition: ITransition, addTime?: number) => {
    return updateProtocol((protocol) => {
      const mainTrack = protocol.tracks.find(track => track.trackType === 'frames' && (track as any).isMain) as TrackTypeMapTrack['frames'] | undefined
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

      const clonedTransition = clone(transition)

      // Apply the transition to both segments
      segment1.transitionIn = clonedTransition
      segment2.transitionOut = clonedTransition

      return true
    })
  }

  const removeTransition = (segmentId: string) => {
    return updateProtocol((protocol) => {
      const mainTrack = protocol.tracks.find(track => track.trackType === 'frames' && (track as any).isMain) as TrackTypeMapTrack['frames'] | undefined
      if (!mainTrack)
        return false

      const idx = mainTrack.children.findIndex(segment => segment.id === segmentId)
      if (idx === -1)
        return false

      // Remove transition: can be called with either segment of the transition pair
      // If segment has transitionIn, it's the start - clear transitionIn and next segment's transitionOut
      // If segment has transitionOut, it's the end - clear transitionOut and previous segment's transitionIn
      const currentSegment = mainTrack.children[idx] as TrackTypeMapSegment['frames']
      const prevSegment = idx > 0 ? mainTrack.children[idx - 1] as TrackTypeMapSegment['frames'] : undefined
      const nextSegment = idx < mainTrack.children.length - 1 ? mainTrack.children[idx + 1] as TrackTypeMapSegment['frames'] : undefined

      let removed = false

      // If current has transitionIn, it's the first segment of the pair
      if (currentSegment.transitionIn) {
        currentSegment.transitionIn = undefined
        if (nextSegment) {
          nextSegment.transitionOut = undefined
        }
        removed = true
      }

      // If current has transitionOut, it's the second segment of the pair
      if (currentSegment.transitionOut) {
        currentSegment.transitionOut = undefined
        if (prevSegment) {
          prevSegment.transitionIn = undefined
        }
        removed = true
      }

      return removed
    })
  }

  const updateTransition = (segmentId: string, updater: (transition: ITransition) => void) => {
    const mainTrack = tracks.value.frames?.find(track => track.trackType === 'frames' && track.isMain) as TrackTypeMapTrack['frames'] | undefined
    if (!mainTrack)
      return false
    const idx = mainTrack.children.findIndex(segment => segment.id === segmentId)

    if (idx === -1)
      return false

    // update transition
    // slice handle error transition data
    updateSegment((segment) => {
      if (!segment.transitionIn)
        return
      updater(segment.transitionIn)
    }, mainTrack.children[idx].id, 'frames')
    updateSegment((segment) => {
      if (!segment.transitionOut)
        return
      updater(segment.transitionOut)
    }, mainTrack.children[idx + 1].id, 'frames')

    return true
  }

  return {
    videoBasicInfo,
    curTime,
    setSelectedSegment,
    selectedSegment,
    trackMap: tracks,
    segmentMap: segments,
    getSegment,
    addSegment,
    removeSegment,
    updateSegment,
    moveSegment,
    resizeSegment,
    exportProtocol,
    addTransition,
    removeTransition,
    updateTransition,

    undo,
    redo,
    redoCount,
    undoCount,
  }
}

function normalizedProtocol(protocol: IVideoProtocol) {
  const normalized = normalizeProtocolTracks(clone(protocol))
  const { state: protocolState, update: updateProtocol, enable, redo, undo, undoCount, redoCount } = useHistory(normalized)
  enable()

  const videoBasicInfo = reactive({
    // version is readonly
    version: computed(() => protocolState.value.version),
    width: protocolState.value.width,
    height: protocolState.value.height,
    fps: protocolState.value.fps,
  })

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
