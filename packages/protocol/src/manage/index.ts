import type { ITrack, ITrackType, IVideoProtocol, SegmentUnion, TrackTypeMapSegment, TrackTypeMapTrack, TrackUnion } from '@video-editor/shared'
import { computed, reactive, ref } from '@vue/reactivity'
import type { PartialByKeys } from './utils'
import { clone, findInsertSegmentIndex, genRandomId } from './utils'

export function createVideoProtocolManager(protocol: IVideoProtocol) {
  const protocolRef = reactive(clone(protocol))

  const videoBasicInfo = reactive({
    // version is readonly
    version: computed(() => protocolRef.version),
    width: protocolRef.width,
    height: protocolRef.height,
    fps: protocolRef.fps,
  })

  const segmentMap = computed(() => {
    const map: Record<string, SegmentUnion | undefined> = {}
    for (const track of protocolRef.tracks) {
      for (const segment of track.children)
        map[segment.id] = segment
    }
    return map
  })

  const trackMap = computed(() => {
    const map: { [K in keyof TrackTypeMapTrack]: TrackTypeMapTrack[K][]; } = {} as any
    for (const track of protocolRef.tracks) {
      if (!map[track.trackType])
        map[track.trackType] = []
      if (track.children.length > 0)
        (map[track.trackType] as TrackTypeMapTrack[ITrackType][]).push(track)
    }
    return map
  })

  const selectedSegment = ref<SegmentUnion>()
  const setSelectedSegment = (id: SegmentUnion['id']) => {
    selectedSegment.value = segmentMap.value[id]
  }

  const curTime = ref(0)

  const addSegmentToTrack = (segment: SegmentUnion) => {
    const track = {
      isMain: segment.segmentType === 'frames' && !(trackMap.value.frames?.length) ? true : undefined,
      trackType: segment.segmentType,
      trackId: genRandomId(),
      children: [segment],
    } satisfies ITrack<ITrackType> as TrackUnion

    protocolRef.tracks.push(track)
    setSelectedSegment(segment.id)
    return segment.id
  }

  const addFramesSegment = (framesSegment: TrackTypeMapSegment['frames']) => {
    const tracks = trackMap.value.frames ?? []
    const mainTrack = tracks.find(track => track.isMain)
    if (!mainTrack)
      return addSegmentToTrack(framesSegment)

    let insertIndex = mainTrack.children.findIndex(segment => segment.startTime < curTime.value && curTime.value <= segment.endTime)
    if (insertIndex === -1)
      insertIndex = mainTrack.children.length - 1
    const diff = mainTrack.children[insertIndex].endTime - framesSegment.startTime
    framesSegment.startTime += diff
    framesSegment.endTime += diff
    mainTrack.children.splice(insertIndex + 1, 0, framesSegment)
    setSelectedSegment(framesSegment.id)
    return framesSegment.id
  }

  const normalizedSegment = (segment: PartialByKeys<TrackTypeMapSegment[ITrackType], 'id'>) => {
    const _segment = clone(segment) as TrackTypeMapSegment[ITrackType]
    if (!_segment.id || segmentMap.value[_segment.id])
      _segment.id = genRandomId()

    const diff = curTime.value - _segment.startTime
    _segment.startTime += diff
    _segment.endTime += diff

    return _segment
  }

  const addSegment = (segment: PartialByKeys<TrackTypeMapSegment[ITrackType], 'id'>) => {
    const theSegment = normalizedSegment(segment)

    if (theSegment.segmentType === 'frames')
      return addFramesSegment(theSegment)

    const tracks = trackMap.value[theSegment.segmentType] ?? []
    for (let i = tracks.length - 1; i >= 0; i--) {
      const children = tracks[i].children as SegmentUnion[]
      const index = findInsertSegmentIndex(theSegment, children, curTime.value)
      if (index !== -1) {
        children.splice(index, 0, theSegment)
        setSelectedSegment(theSegment.id)
        return theSegment.id
      }
    }

    return addSegmentToTrack(theSegment)
  }

  const removeSegment = (id: SegmentUnion['id']) => {
    for (const track of protocolRef.tracks) {
      for (let i = 0; i < track.children.length; i++) {
        if (track.children[i].id === id) {
          track.children.splice(i, 1)
          return true
        }
      }
    }
    return false
  }

  return {
    videoBasicInfo,
    selectedSegment,
    curTime,
    setSelectedSegment,
    trackMap,
    segmentMap,
    addSegment,
    removeSegment,
  }
}
