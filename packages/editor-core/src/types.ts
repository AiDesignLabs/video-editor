import type { ComputedRef, DeepReadonly } from '@vue/reactivity'
import type { createVideoProtocolManager } from '@video-editor/protocol'
import type { ITrackType, IVideoProtocol, SegmentUnion, TrackUnion } from '@video-editor/shared'

/** Internal protocol manager type used to align editor-core signatures with protocol behavior. */
type ProtocolManager = ReturnType<typeof createVideoProtocolManager>

/** Input payload for adding a segment (id is optional). */
export type SegmentInput = Parameters<ProtocolManager['addSegment']>[0]

/** Result payload returned by addSegment. */
export type AddSegmentResult = ReturnType<ProtocolManager['addSegment']>

/** Result payload returned by segment mutation commands. */
export type SegmentMutationResult = ReturnType<ProtocolManager['removeSegment']>

/** Options for moving a segment between tracks or within a track. */
export type MoveSegmentOptions = Parameters<ProtocolManager['moveSegment']>[0]

/** Options for resizing a segment on a track. */
export type ResizeSegmentOptions = Parameters<ProtocolManager['resizeSegment']>[0]

/**
 * Read-only editor state derived from the reactive protocol.
 * All mutations should go through commands.
 */
export interface EditorCoreState {
  /** Reactive protocol snapshot. */
  protocol: ProtocolManager['protocol']
  /** Project-level properties (width/height/fps/version). */
  videoBasicInfo: ProtocolManager['videoBasicInfo']
  /** Current playhead time in ms. */
  currentTime: ProtocolManager['curTime']
  /** Currently selected segment (read-only). */
  selectedSegment: ProtocolManager['selectedSegment']
  /** Selected segment id, derived from the current selection. */
  selectedSegmentId: ComputedRef<string | undefined>
  /** Track list grouped by segment type. */
  trackMap: ProtocolManager['trackMap']
  /** Segment lookup table keyed by segment id. */
  segmentMap: ProtocolManager['segmentMap']
  /** Total duration computed from protocol tracks. */
  duration: ComputedRef<number>
  /** Undo stack size. */
  undoCount: ProtocolManager['undoCount']
  /** Redo stack size. */
  redoCount: ProtocolManager['redoCount']
}

/**
 * Commands are the only supported way to mutate protocol state.
 */
export interface EditorCoreCommands {
  /** Set the playhead time in ms. */
  setCurrentTime: (time: number) => void
  /** Update the selected segment id. */
  setSelectedSegment: ProtocolManager['setSelectedSegment']
  /** Insert a segment into the timeline. */
  addSegment: ProtocolManager['addSegment']
  /** Remove a segment by id. */
  removeSegment: ProtocolManager['removeSegment']
  /** Mutate a segment (by id or current selection). */
  updateSegment: ProtocolManager['updateSegment']
  /** Move a segment between tracks or positions. */
  moveSegment: ProtocolManager['moveSegment']
  /** Resize a segment's time range. */
  resizeSegment: ProtocolManager['resizeSegment']
  /** Add a transition at the current time or a specified time. */
  addTransition: ProtocolManager['addTransition']
  /** Remove a transition by segment id. */
  removeTransition: ProtocolManager['removeTransition']
  /** Update a transition by segment id. */
  updateTransition: ProtocolManager['updateTransition']
  /** Replace a track id (useful for migrations). */
  replaceTrackId: ProtocolManager['replaceTrackId']
  /** Replace a segment id (useful for migrations). */
  replaceSegmentId: ProtocolManager['replaceSegmentId']
  /** Undo the last mutation. */
  undo: ProtocolManager['undo']
  /** Redo the last undone mutation. */
  redo: ProtocolManager['redo']
  /** Export the current protocol as a plain object snapshot. */
  exportProtocol: ProtocolManager['exportProtocol']
}

/**
 * Read-only helpers for querying protocol data.
 */
export interface EditorCoreSelectors {
  /** Find a segment by id (and optionally type). */
  getSegment: ProtocolManager['getSegment']
  /** Find a track by id (read-only reference). */
  getTrackById: (trackId: string) => DeepReadonly<TrackUnion> | undefined
  /** Find the track that owns a segment id. */
  getTrackBySegmentId: (segmentId: string) => DeepReadonly<TrackUnion> | undefined
  /** List tracks, optionally filtered by type. */
  getTracks: (trackType?: ITrackType) => DeepReadonly<TrackUnion>[]
}

/**
 * Arbitrary shared services injected into editor-core (resource, renderer, etc).
 */
export interface EditorCoreServices {
  [key: string]: unknown
}

/**
 * The context passed to plugin creators.
 */
export interface EditorCoreContext {
  state: EditorCoreState
  commands: EditorCoreCommands
  selectors: EditorCoreSelectors
  registry: {
    segments: SegmentRegistry
  }
  services: EditorCoreServices
}

/**
 * Optional UI bindings for a segment plugin (editor-ui can consume these).
 */
export interface SegmentPluginUI {
  panel?: unknown
  track?: unknown
  resource?: unknown
}

/**
 * Optional behavior hooks for a segment type.
 */
export interface SegmentPluginOps<TSegment extends SegmentUnion = SegmentUnion> {
  create?: (ctx: EditorCoreContext, partial?: Partial<TSegment>) => TSegment
  update?: (ctx: EditorCoreContext, id: string, patch: Partial<TSegment>) => void
  remove?: (ctx: EditorCoreContext, id: string) => void
  split?: (ctx: EditorCoreContext, id: string, time: number) => void
}

/**
 * Segment plugin bundle: ops + renderer adapter + optional UI bindings.
 */
export interface SegmentPlugin<TSegment extends SegmentUnion = SegmentUnion, RenderNode = unknown, UI = SegmentPluginUI> {
  /** The segment type this plugin handles. */
  type: TSegment['segmentType']
  /** Optional operations for this segment type. */
  ops?: SegmentPluginOps<TSegment>
  /** Convert a segment into a renderer-specific node. */
  renderer?: {
    toRenderNode: (segment: TSegment, ctx: EditorCoreContext) => RenderNode | null
  }
  /** Optional UI bindings (panel, track, resource). */
  ui?: UI
}

/**
 * Registry for segment-type plugins (type -> plugin lookup).
 */
export interface SegmentRegistry {
  register: (plugin: SegmentPlugin, options?: { override?: boolean }) => void
  get: (type: ITrackType) => SegmentPlugin | undefined
  list: () => SegmentPlugin[]
}

/**
 * Base plugin interface for editor-core.
 */
export interface EditorCorePlugin {
  /** Plugin name, must be unique within the editor instance. */
  name: string
  /** Initialize side effects or register UI/handlers. */
  init?: () => Promise<void> | void
  /** Cleanup side effects. */
  destroy?: () => Promise<void> | void
  /** Optional plugin metadata. */
  meta?: {
    dependencies?: string[]
  }
}

/** Create a plugin from the editor context. */
export type EditorCorePluginCreator = (ctx: EditorCoreContext) => EditorCorePlugin

/**
 * Plugin manager used by editor-core.
 */
export interface EditorCorePluginManager {
  /** Register a plugin creator. */
  register: (pluginCreator: EditorCorePluginCreator, options?: { autoInit?: boolean; override?: boolean }) => Promise<void>
  /** Initialize all registered plugins. */
  init: () => Promise<void>
  /** Fetch a plugin by name. */
  get: (pluginName: string) => EditorCorePlugin | undefined
  /** Check if a plugin exists. */
  has: (pluginName: string) => boolean
  /** Remove a plugin by name (calls destroy). */
  remove: (pluginName: string) => Promise<boolean>
  /** Destroy and clear all plugins. */
  destroy: () => Promise<void>
}

/**
 * Editor-core initialization options.
 */
export interface EditorCoreOptions {
  /** Initial protocol snapshot. */
  protocol: IVideoProtocol
  /** Optional id generators for segments/tracks. */
  idFactory?: {
    segment?: () => string
    track?: () => string
  }
  /** Optional shared services (resource manager, renderer, etc). */
  services?: EditorCoreServices
}

/**
 * The headless editor-core instance.
 */
export interface EditorCore {
  /** Read-only state tree. */
  state: EditorCoreState
  /** Mutation commands. */
  commands: EditorCoreCommands
  /** Read-only selectors. */
  selectors: EditorCoreSelectors
  /** Plugin manager instance. */
  plugins: EditorCorePluginManager
  /** Segment plugin registry. */
  registry: {
    segments: SegmentRegistry
  }
  /** Shared services passed at initialization. */
  services: EditorCoreServices
  /** Dispose resources. */
  destroy: () => Promise<void>
}
