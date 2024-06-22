import type { ITrack, ITrackType, IVideoProtocol, SegmentUnion, TrackTypeMapSegment, TrackTypeMapTrack, TrackUnion } from '@video-editor/shared'
import type { DeepReadonly } from '@vue/reactivity'
import { computed, reactive, ref, toRaw } from '@vue/reactivity'
import { createValidator } from '../verify'
import type { PartialByKeys } from './utils'
import { clone, findInsertFramesSegmentIndex, findInsertSegmentIndex, genRandomId } from './utils'
import { useHistory } from './immer'
import { checkSegment, handleSegmentUpdate } from './segment'

export function createVideoProtocolManager(protocol: IVideoProtocol) {
  const validator = createValidator()

  const { videoBasicInfo, segments, tracks, updateProtocol, undo, exportProtocol, undoCount, redoCount } = normalizedProtocol(validator.verify(protocol))

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

  const addSegment = (segment: PartialByKeys<TrackTypeMapSegment[ITrackType], 'id'>) => {
    const theSegment = normalizedSegment(segment)

    try {
      validator.verifySegment(theSegment)
    }
    catch (error) {
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

  function updateSegment(updater: (segment: SegmentUnion) => void, id?: string) {
    updateProtocol((protocol) => {
      const _id = id ?? selectedSegment.value?.id
      if (_id === undefined)
        return
      const segment = getTrackBySegmentId(_id, protocol)
      if (segment)
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

  return {
    videoBasicInfo,
    curTime,
    setSelectedSegment,
    selectedSegment,
    trackMap: tracks,
    segmentMap: segments,
    addSegment,
    removeSegment,
    updateSegment,
    exportProtocol,
    undoCount,
    redoCount,
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
