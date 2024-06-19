import type { IVideoProtocol } from '@video-editor/shared'
import type { Patch } from 'immer'
import type { createValidator } from '../verify'

export function handleSegmentUpdate(patches: Patch[], inversePatches: Patch[], draft: IVideoProtocol, undo: () => void) {
  for (let i = 0; i < patches.length; i++) {
    if (patches[i].path.at(-1) === 'endTime') {
      adjustSegmentEndTime(patches[i], inversePatches[i], draft)
      break
    }
    else if (patches[i].path.at(-1) === 'startTime') {
      break
    }
    else if (patches[i].path.at(-1) === 'id') {
      rollbackChange(patches[i], inversePatches[i], draft)
      undo()
    }
    else if (patches[i].path.at(-1) === 'segmentType') {
      rollbackChange(patches[i], inversePatches[i], draft)
      undo()
    }
  }
}

function rollbackChange(patch: Patch, inversePatch: Patch, draft: IVideoProtocol) {
  // path: [ 'tracks', 0, 'children', 0, 'endTime' ]
  const [p1, trackIndex, p2, childIndex, p3] = patch.path
  // @ts-expect-error type is correct
  draft[p1][trackIndex][p2][childIndex][p3] = inversePatch.value
}

function adjustSegmentEndTime(patch: Patch, inversePatch: Patch, draft: IVideoProtocol) {
  // update children segment time
  // path: [ 'tracks', 0, 'children', 0, 'endTime' ]
  const [, trackIndex, , childIndex] = patch.path
  const tracks = draft.tracks
  if (typeof trackIndex !== 'number' || typeof childIndex !== 'number' || !tracks)
    return
  const diff = patch.value - inversePatch.value
  for (let j = childIndex + 1; j < tracks[trackIndex].children.length; j++) {
    const segment = tracks[trackIndex].children[j]
    segment.startTime += diff
    segment.endTime += diff
  }
}

export function checkSegment(patches: Patch[], inversePatches: Patch[], draft: IVideoProtocol, validator: ReturnType<typeof createValidator>) {
  return patches.every((patch, i) => {
    // path: [ 'tracks',  0, 'children', 0, 'endTime' ]
    const [, trackIndex, , childIndex, attr] = patch.path
    if (typeof trackIndex !== 'number' || typeof childIndex !== 'number')
      return false
    const segment = draft.tracks[trackIndex].children[childIndex]
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
