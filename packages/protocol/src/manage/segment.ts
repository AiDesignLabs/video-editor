import type { ITrackType } from '@video-editor/shared'
import type { Patch } from 'immer'
import type { createValidator } from '../verify'
import type { IMappingVideoProtocol } from './type'

export function handleSegmentUpdate(patches: Patch[], inversePatches: Patch[], draft: IMappingVideoProtocol) {
  for (let i = 0; i < patches.length; i++) {
    if (patches[i].path.at(-1) === 'endTime') {
      adjustSegmentEndTime(patches[i], inversePatches[i], draft)
      break
    }
  }
}

function adjustSegmentEndTime(patch: Patch, inversePatch: Patch, draft: IMappingVideoProtocol) {
  // update children segment time
  // path: [ 'tracks', 'frames', 0, 'children', 0, 'endTime' ]
  const [, trackType, trackIndex, , childIndex] = patch.path
  const tracks = draft.tracks[trackType as ITrackType]
  if (typeof trackIndex !== 'number' || typeof childIndex !== 'number' || !tracks)
    return
  const diff = patch.value - inversePatch.value
  for (let j = childIndex + 1; j < tracks[trackIndex].children.length; j++) {
    const segment = tracks[trackIndex].children[j]
    segment.startTime += diff
    segment.endTime += diff
  }
}

export function checkSegment(patches: Patch[], inversePatches: Patch[], draft: IMappingVideoProtocol, validator: ReturnType<typeof createValidator>) {
  return patches.every((patch, i) => {
    // path: [ 'tracks', 'frames', 0, 'children', 0, 'endTime' ]
    const [, trackType, trackIndex, , childIndex, attr] = patch.path
    if (typeof trackIndex !== 'number' || typeof childIndex !== 'number')
      return false
    const segment = draft.tracks[trackType as ITrackType][trackIndex].children[childIndex]
    try {
      validator.verifySegment(segment)
    }
    catch (error) {
      // undo the update
      // @ts-expect-error type is correct
      segment[attr] = inversePatches[i].value
      return false
    }
    return true
  })
}
