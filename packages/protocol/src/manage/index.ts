import type { ITrack, ITrackType, ITransition, IVideoProtocol, SegmentUnion, TrackTypeMapSegment, TrackTypeMapTrack, TrackUnion } from '@video-editor/shared'
import type { DeepReadonly } from '@vue/reactivity'
import type { PartialByKeys } from './utils'
import { computed, reactive, ref, toRaw } from '@vue/reactivity'
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

  const addFramesSegment = (framesSegment: TrackTypeMapSegment['frames'], track: TrackTypeMapTrack['frames']) => {
    const insertIndex = findInsertFramesSegmentIndex(track.children, curTime.value)

    if (insertIndex === 0) {
      framesSegment.endTime -= framesSegment.startTime
      framesSegment.startTime = 0
    }
    else {
      const prevSegment = track.children[insertIndex - 1]
      framesSegment.endTime = prevSegment.endTime + (framesSegment.endTime - framesSegment.startTime)
      framesSegment.startTime = prevSegment.endTime
    }

    track.children.splice(insertIndex, 0, framesSegment)

    for (let j = insertIndex; j < track.children.length; j++) {
      const segment = track.children[j]
      const preSegmentEndTime = track.children[j - 1]?.endTime ?? 0
      segment.endTime = preSegmentEndTime + (segment.endTime - segment.startTime)
      segment.startTime = preSegmentEndTime
    }
    return framesSegment.id
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
    const mainTrack = tracks.value.frames?.find(track => track.trackType === 'frames' && track.isMain) as TrackTypeMapTrack['frames'] | undefined
    if (!mainTrack || mainTrack.children.length < 2)
      return false
    const insertTime = Math.max(0, addTime ?? curTime.value)
    let startSegmentIdx = findInsertFramesSegmentIndex(mainTrack.children, insertTime) - 1

    // cross first segment left half time, or
    // cross last segment right half time
    startSegmentIdx = Math.min(Math.max(0, startSegmentIdx), mainTrack.children.length - 2)

    // update transition
    // slice handle error transition data
    updateSegment((segment) => {
      segment.transitionIn = clone(transition)
    }, mainTrack.children[startSegmentIdx].id, 'frames')
    updateSegment((segment) => {
      segment.transitionOut = clone(transition)
    }, mainTrack.children[startSegmentIdx + 1].id, 'frames')

    return true
  }

  const removeTransition = (segmentId: string) => {
    const mainTrack = tracks.value.frames?.find(track => track.trackType === 'frames' && track.isMain) as TrackTypeMapTrack['frames'] | undefined
    if (!mainTrack)
      return false
    const idx = mainTrack.children.findIndex(segment => segment.id === segmentId)

    if (idx === -1)
      return false

    // update transition
    // slice handle error transition data
    updateSegment((segment) => {
      segment.transitionIn = undefined
    }, mainTrack.children[idx].id, 'frames')
    updateSegment((segment) => {
      segment.transitionOut = undefined
    }, mainTrack.children[idx + 1].id, 'frames')

    return true
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
  const { state: protocolState, update: updateProtocol, enable, redo, undo, undoCount, redoCount } = useHistory(clone(protocol))
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
        map[segment.id] = segment
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

function getTrackBySegmentId(segmentId: string, protocol: IVideoProtocol) {
  for (const track of protocol.tracks) {
    const segment = track.children.find(segment => segment.id === segmentId)
    if (segment)
      return segment
  }
  return undefined
}
