import type { ITrack, ITrackType, IVideoProtocol, SegmentUnion, TrackTypeMapSegment, TrackTypeMapTrack, TrackUnion } from '@video-editor/shared'
import type { DeepReadonly } from '@vue/reactivity'
import { computed, reactive, ref } from '@vue/reactivity'
import type { PartialByKeys } from './utils'
import { clone, findInsertSegmentIndex, genRandomId } from './utils'
import { useHistory } from './immer'
import type { IMappingVideoProtocol } from './type'

export function createVideoProtocolManager(protocol: IVideoProtocol) {
  const { videoBasicInfo, segments, tracks, updateProtocol } = normalizedProtocol(protocol)

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

  const addSegmentToTrack = <T extends SegmentUnion>(segment: T, tracks: TrackTypeMapTrack[T['segmentType']][]) => {
    const track = {
      isMain: segment.segmentType === 'frames' && !(tracks?.length) ? true : undefined,
      trackType: segment.segmentType,
      trackId: genRandomId(),
      children: [segment],
    } satisfies ITrack<ITrackType> as TrackUnion
    (tracks as TrackTypeMapTrack[ITrackType][]).push(track)
    return segment.id
  }

  const addFramesSegment = (framesSegment: TrackTypeMapSegment['frames'], tracks: TrackTypeMapTrack['frames'][]) => {
    const mainTrack = tracks.find(track => track.isMain)
    if (!mainTrack)
      return addSegmentToTrack(framesSegment, tracks)

    let insertIndex = mainTrack.children.findIndex(segment => segment.startTime < curTime.value && curTime.value <= segment.endTime)
    if (insertIndex === -1)
      insertIndex = mainTrack.children.length - 1
    const diff = mainTrack.children[insertIndex].endTime - framesSegment.startTime
    framesSegment.startTime += diff
    framesSegment.endTime += diff
    mainTrack.children.splice(insertIndex + 1, 0, framesSegment)
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

    return updateProtocol((protocol) => {
      if (theSegment.segmentType === 'frames')
        return addFramesSegment(theSegment, protocol.tracks.frames)

      const tracks = protocol.tracks[theSegment.segmentType] ?? []
      for (let i = tracks.length - 1; i >= 0; i--) {
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
      for (const trackType in protocol.tracks) {
        const type = trackType as ITrackType
        const tracks = protocol.tracks[type]
        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i]
          const index = track.children.findIndex(segment => segment.id === id)
          if (index !== -1) {
            track.children.splice(index, 1)
            if (track.children.length === 0)
              protocol.tracks[type].splice(i, 1)
            return true
          }
        }
      }
      return false
    })
  }

  function updateSegment(updater: (segment: SegmentUnion) => void, id?: string) {
    return updateProtocol((protocol) => {
      const _id = id ?? selectedSegment.value?.id
      if (_id === undefined)
        return
      const segment = getTrackBySegmentId(_id, protocol)
      if (segment)
        updater(segment)
    }, (patches, inversePatches, effect) => {
      // update children segment time
      const i = patches.findIndex(patch => patch.path.at(-1) === 'endTime')
      if (i >= 0) {
        // path: [ 'tracks', 'frames', 0, 'children', 0, 'endTime' ]
        const [, trackType, trackIndex, , childIndex] = patches[i].path
        effect((draft) => {
          const tracks = draft.tracks[trackType as ITrackType]
          if (typeof trackIndex !== 'number' || typeof childIndex !== 'number' || !tracks)
            return
          const diff = patches[i].value - inversePatches[i].value
          for (let j = childIndex + 1; j < tracks[trackIndex].children.length; j++) {
            const segment = tracks[trackIndex].children[j]
            segment.startTime += diff
            segment.endTime += diff
          }
        })
      }
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
  }
}

function normalizedProtocol(protocol: IVideoProtocol) {
  const cloneProtocol = clone(protocol)
  const mappingProtocol: IMappingVideoProtocol = {
    ...cloneProtocol,
    tracks: {
      frames: [],
      text: [],
      image: [],
      audio: [],
      effect: [],
      filter: [],
    },
  }
  for (const track of cloneProtocol.tracks) {
    if (!mappingProtocol.tracks[track.trackType])
      mappingProtocol.tracks[track.trackType] = []
    if (track.children.length > 0)
      (mappingProtocol.tracks[track.trackType] as TrackTypeMapTrack[ITrackType][]).push(track)
  }
  const { state: protocolState, update: updateProtocol, enable } = useHistory(mappingProtocol)
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
    for (const trackType in protocolState.value.tracks) {
      for (const track of protocolState.value.tracks[trackType as ITrackType]) {
        for (const segment of track.children)
          map[segment.id] = segment
      }
    }
    return map
  })

  const tracks = computed(() => protocolState.value.tracks)

  return {
    videoBasicInfo,
    protocolState,
    updateProtocol,
    tracks,
    segments,
  }
}

function getTrackBySegmentId(segmentId: string, protocol: IMappingVideoProtocol) {
  for (const trackType in protocol.tracks) {
    const type = trackType as ITrackType
    for (const track of protocol.tracks[type]) {
      const segment = track.children.find(segment => segment.id === segmentId)
      if (segment)
        return segment
    }
  }
  return undefined
}
