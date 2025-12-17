export { createVideoProtocolManager } from './manage'
export { parse } from './parse'
export {
  createResourceManager,
  DEFAULT_RESOURCE_DIR,
  generateThumbnails,
  getResourceKey,
  getMp4Meta,
} from './resource'
export {
  fileTo,
  fileToMP4Samples,
  getResourceType,
  vFetch,
} from './resource/fetch'
export {
  createValidator,
  DUPLICATE_SEGMENT_ID,
  DUPLICATE_TRACK_ID,
} from './verify'
export type {
  ITrackType,
  IVideoProtocol,
  SegmentUnion,
  TrackTypeMapSegment,
  TrackUnion,
} from '@video-editor/shared'
