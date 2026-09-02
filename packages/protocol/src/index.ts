export {
  createAssetLibrary,
  DEFAULT_ASSET_MANIFEST_DIR,
  findAssetReferences,
} from './assets'
export type {
  AssetDerivation,
  AssetKind,
  AssetLibrary,
  AssetLibraryOptions,
  AssetMeta,
  AssetReference,
  AssetRemovalContext,
  AssetUrlResolutionOptions,
} from './assets'
export { createMediaAssetCatalog } from './assets/catalog'
export type {
  MediaAsset,
  MediaAssetCatalog,
  MediaAssetCatalogOptions,
  MediaAssetProxyStatus,
  SegmentAssetBinding,
} from './assets/catalog'
export { createVideoProtocolManager, MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, MIN_FPS } from './manage'
export type {
  AddTrackOptions,
  AddTrackResult,
  CanvasSize,
  HistoryMutationResult,
  OperationLogEntry,
  OperationLogMeta,
  ReplaceAssetStrategy,
  ReplaceSegmentAssetOptions,
  ReplaceSegmentAssetResult,
  SetCanvasSizeResult,
  SetFpsResult,
  TrackMutableFields,
  TrackStructureResult,
  TransactionHandle,
  TransactionMeta,
  TransactionOptions,
  TransactionResult,
  TransactionStatus,
  UndoStackItem,
} from './manage'
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
  clearMp4MetaCache,
  clearThumbnailCache,
  clearWaveformCache,
  createResourceManager,
  DEFAULT_RESOURCE_DIR,
  extractWaveform,
  extractWaveformFromBuffer,
  generateThumbnails,
  getMp4Meta,
  getResourceKey,
  invalidateResourceDerivatives,
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
