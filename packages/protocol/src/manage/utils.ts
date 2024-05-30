import type { ITrackType, TrackTypeMapSegment } from '@video-editor/shared'

export function genRandomId() {
  return (Date.now() + Math.floor(Math.random() * 10000000)).toString()
}

export function findInsertSegmentIndex<T extends TrackTypeMapSegment[ITrackType]>(segment: T, arr: T[], curTime: number) {
  if (arr.length === 0)
    return 0

  // check if the curTime is in any segment
  if (arr.some(item => item.startTime <= curTime && item.endTime > curTime))
    return -1

  // find the next segment, the arr must sorted by startTime
  const nextIndex = arr.findIndex(item => item.startTime > curTime)
  if (nextIndex === -1) // curTime is after the last segment
    return arr.length
  if (arr[nextIndex].startTime - curTime >= segment.endTime - segment.startTime)
    return nextIndex
  return nextIndex - 1
}

export function clone<T>(obj: T): T {
  if (structuredClone)
    return structuredClone(obj)

  return JSON.parse(JSON.stringify(obj))
}

export type PartialByKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
