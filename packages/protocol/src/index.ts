export {
  createAssetLibrary,
  DEFAULT_ASSET_MANIFEST_DIR,
} from './assets'
export type {
  AssetKind,
  AssetLibrary,
  AssetLibraryOptions,
  AssetMeta,
} from './assets'
export { createVideoProtocolManager, MAX_CANVAS_SIZE, MIN_CANVAS_SIZE } from './manage'
export type { CanvasSize, SetCanvasSizeResult, TrackMutableFields } from './manage'
export { parse } from './parse'
export {
  createProjectStore,
  DEFAULT_PROJECT_DIR,
} from './project'
export type {
  ProjectMeta,
  ProjectStore,
  ProjectStoreOptions,
  StoredProject,
} from './project'
export {
  clearWaveformCache,
  createResourceManager,
  DEFAULT_RESOURCE_DIR,
  extractWaveform,
  extractWaveformFromBuffer,
  generateThumbnails,
  getMp4Meta,
  getResourceKey,
  peaksToBars,
  peaksToSvgPath,
} from './resource'
export type { WaveformData, WaveformOptions } from './resource'
export {
  fileTo,
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
