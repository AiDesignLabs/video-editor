import type { createVideoProtocolManager } from '@video-editor/protocol'
import type { IKeyframeEasing, IKeyframeProperty, ITrackType, IVideoProtocol, SegmentUnion, TrackUnion } from '@video-editor/shared'
import type { ComputedRef, DeepReadonly } from '@vue/reactivity'

/** Internal protocol manager type used to align editor-core signatures with protocol behavior. */
type ProtocolManager = ReturnType<typeof createVideoProtocolManager>

/** Input payload for adding a segment (id is optional). */
export type SegmentInput = Parameters<ProtocolManager['addSegment']>[0]

/** Result payload returned by addSegment. */
export type AddSegmentResult = ReturnType<ProtocolManager['addSegment']>

/** Result payload returned by segment mutation commands. */
export type SegmentMutationResult = ReturnType<ProtocolManager['removeSegment']>

/** Result payload returned by duplicateSegment. */
export type DuplicateSegmentResult = ReturnType<ProtocolManager['duplicateSegment']>

/** Optional flags accepted by removeSegment (e.g. ripple delete). */
export type RemoveSegmentOptions = Parameters<ProtocolManager['removeSegment']>[1]

/** Result payload returned by setCanvasSize. */
export type SetCanvasSizeResult = ReturnType<ProtocolManager['setCanvasSize']>

/** Result payload returned by setFps. */
export type SetFpsResult = ReturnType<ProtocolManager['setFps']>

/** Input and result types for track structure commands. */
export type AddTrackOptions = Parameters<ProtocolManager['addTrack']>[0]
export type AddTrackResult = ReturnType<ProtocolManager['addTrack']>
export type TrackStructureResult = ReturnType<ProtocolManager['removeTrack']>

/** The mutable track fields exposed to an updateTrack updater. */
export type TrackMutableFields = Parameters<Parameters<ProtocolManager['updateTrack']>[1]>[0]

/** Options for moving a segment between tracks or within a track. */
export type MoveSegmentOptions = Parameters<ProtocolManager['moveSegment']>[0]

/** Options for resizing a segment on a track. */
export type ResizeSegmentOptions = Parameters<ProtocolManager['resizeSegment']>[0]

/** Where a segment sits: the segment itself plus the track carrying it. */
export interface SegmentPlacement {
  segment: SegmentUnion
  trackId: string
  trackType: ITrackType
}

export interface SegmentsAtOptions {
  /** Only look at tracks of this type. */
  trackType?: ITrackType
  /** Pass `false` to skip hidden tracks — what is actually on screen. */
  includeHidden?: boolean
}

/** A bounded stretch of empty time on a track. */
export interface TrackGap {
  startTime: number
  endTime: number
}

export interface SegmentNeighbours {
  trackId?: string
  previous?: SegmentUnion
  next?: SegmentUnion
}

/** Two segments of one track sharing time, which the timeline rules forbid. */
export interface SegmentOverlap {
  trackId: string
  a: SegmentUnion
  b: SegmentUnion
  /** The overlapping stretch itself. */
  startTime: number
  endTime: number
}

/**
 * A property's effective value at a moment, and where it came from — a curve,
 * the segment's own field, or the documented fallback. An agent reviewing a
 * value needs to know which, since only an interpolated one is changing here.
 *
 * `keyframe` covers a value read straight off a frame, including one held at
 * either end of the curve; `interpolated` means strictly between two frames.
 */
export interface SampledProperty {
  value: number
  source: 'keyframe' | 'interpolated' | 'static' | 'default'
  /** False when the queried time lies outside the segment's own range. */
  withinSegment: boolean
}

export interface EditorSelection {
  segmentId?: string
  segment?: SegmentUnion
  trackId?: string
}

export interface UpsertKeyframeOptions {
  segmentId: string
  property: IKeyframeProperty
  /** Segment-relative timeline time in ms. */
  timeMs: number
  value: number
  /** When omitted, an existing frame keeps its easing. */
  easing?: IKeyframeEasing
}

export interface MoveKeyframeOptions {
  segmentId: string
  property: IKeyframeProperty
  /** Current segment-relative timeline time in ms. */
  timeMs: number
  /** New segment-relative timeline time in ms. */
  toTimeMs: number
}

export interface RemoveKeyframeOptions {
  segmentId: string
  property: IKeyframeProperty
  /** Segment-relative timeline time in ms. */
  timeMs: number
}

export interface SetKeyframeEasingOptions extends RemoveKeyframeOptions {
  /** Omit to restore linear easing. */
  easing?: IKeyframeEasing
}

export interface KeyframeCommandResult {
  success: boolean
  error?: string
}

export type KeyframeCommandCheck
  = | { command: 'upsertKeyframe', input: UpsertKeyframeOptions }
    | { command: 'moveKeyframe', input: MoveKeyframeOptions }
    | { command: 'removeKeyframe', input: RemoveKeyframeOptions }
    | { command: 'setKeyframeEasing', input: SetKeyframeEasingOptions }

/** The commands `canRun` can answer for, with the arguments each needs. */
export type CommandCheck
  = | { command: 'undo' }
    | { command: 'redo' }
    | { command: 'removeSegment', segmentId: string }
    | { command: 'duplicateSegment', segmentId: string }
    | { command: 'splitSegment', segmentId: string, timelineMs: number }
    | { command: 'addTransition' }
    | { command: 'setCanvasSize', width: number, height: number }
    | { command: 'setFps', fps: number }
    | { command: 'addTrack', input: AddTrackOptions }
    | { command: 'removeTrack', trackId: string }
    | { command: 'moveTrack', trackId: string, toIndex: number }
    | KeyframeCommandCheck

export interface CommandCheckResult {
  ok: boolean
  /** Why the command would refuse. Absent when `ok`. */
  reason?: string
}

/**
 * Outcome of a batch command.
 *
 * A batch is atomic: either every step landed and `success` is true, or nothing
 * did and `error` says which step refused. The resulting protocol is read from
 * `editor.state`, which is reactive — the batch reports what it operated on, not
 * a snapshot that later steps in the same transaction may already have moved.
 */
export interface BatchResult {
  success: boolean
  /** Why the batch was rejected. Absent on success. */
  error?: string
  /**
   * The segments the batch operated on, in call order. For
   * `duplicateSegments` these are the new copies, not the sources.
   */
  segmentIds: string[]
}

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
  /** Semantic descriptions of the currently reachable history branch. */
  operationLog: ProtocolManager['operationLog']
  /** Whether a history transaction is currently open. */
  isTransactionActive: ProtocolManager['isTransactionActive']
  /** Nesting depth of the open transaction; 0 when none is open. */
  transactionDepth: ProtocolManager['transactionDepth']
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
  /** Remove a segment by id, optionally rippling later segments on the track left. */
  removeSegment: ProtocolManager['removeSegment']
  /** Duplicate a segment and place the copy at the current playhead (single undo step). */
  duplicateSegment: ProtocolManager['duplicateSegment']
  /** Mutate a segment (by id or current selection). */
  updateSegment: ProtocolManager['updateSegment']
  /** Move a segment between tracks or positions. */
  moveSegment: ProtocolManager['moveSegment']
  /** Resize a segment's time range. */
  resizeSegment: ProtocolManager['resizeSegment']
  /** Split a segment into two at a timeline position (single undo step). */
  splitSegment: ProtocolManager['splitSegment']
  /** Add a transition at the current time or a specified time. */
  addTransition: ProtocolManager['addTransition']
  /** Remove a transition by segment id. */
  removeTransition: ProtocolManager['removeTransition']
  /** Update a transition by segment id. */
  updateTransition: ProtocolManager['updateTransition']
  /** Update a track's mutable presentation fields (hidden / muted / extra). */
  updateTrack: ProtocolManager['updateTrack']
  /** Add an empty track. */
  addTrack: ProtocolManager['addTrack']
  /** Remove a track and all of its segments as one undo step. */
  removeTrack: ProtocolManager['removeTrack']
  /** Move a track to its final zero-based position. */
  moveTrack: ProtocolManager['moveTrack']
  /** Resize the project canvas as a single undoable step. */
  setCanvasSize: ProtocolManager['setCanvasSize']
  /** Set the project frame rate as a single undoable step. */
  setFps: ProtocolManager['setFps']
  /** Insert a keyframe, or update the value at the same property and time. */
  upsertKeyframe: (input: UpsertKeyframeOptions) => KeyframeCommandResult
  /** Move one keyframe without replacing a frame already at the target time. */
  moveKeyframe: (input: MoveKeyframeOptions) => KeyframeCommandResult
  /** Remove one keyframe and clean up its empty property track. */
  removeKeyframe: (input: RemoveKeyframeOptions) => KeyframeCommandResult
  /** Change one keyframe's outgoing easing; omit easing to restore linear. */
  setKeyframeEasing: (input: SetKeyframeEasingOptions) => KeyframeCommandResult
  /** Replace a track id (useful for migrations). */
  replaceTrackId: ProtocolManager['replaceTrackId']
  /** Replace a segment id (useful for migrations). */
  replaceSegmentId: ProtocolManager['replaceSegmentId']
  /**
   * Move several segments as one undo step. Moves are applied in the order
   * given; if any is refused the whole batch is rolled back.
   */
  moveSegments: (moves: readonly MoveSegmentOptions[]) => BatchResult
  /**
   * Remove several segments as one undo step. Later segments are removed first,
   * since a ripple delete shifts the ones after it left.
   */
  removeSegments: (ids: readonly string[], options?: RemoveSegmentOptions) => BatchResult
  /**
   * Apply the same edit to several segments as one undo step — the entry point
   * for adjusting a property across a multi-selection. An edit the protocol
   * rejects fails the whole batch rather than being silently skipped.
   */
  updateSegments: (ids: readonly string[], updater: (segment: SegmentUnion) => void) => BatchResult
  /** Duplicate several segments as one undo step; reports the new ids. */
  duplicateSegments: (ids: readonly string[]) => BatchResult
  /**
   * Run a batch of commands as one atomic undo step.
   *
   * Every command inside still updates state immediately, so previews stay
   * live, but only one history item is pushed when the batch commits. If the
   * body throws, the protocol is restored and the error is rethrown; calling
   * `tx.cancel()` discards the batch without touching the undo/redo stacks.
   */
  transaction: ProtocolManager['transaction']
  /**
   * Open a transaction that spans multiple events, for continuous interactions
   * such as a canvas or timeline drag. Commit on pointer up, cancel to restore
   * the state captured at pointer down.
   */
  beginTransaction: ProtocolManager['beginTransaction']
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
  /**
   * Every segment playing at `timeMs`, in track order — the answer to "what is
   * on screen right now". Segment ranges are half-open, so a segment ending at
   * `timeMs` and the one starting there are never both returned.
   */
  getSegmentsAt: (timeMs: number, options?: SegmentsAtOptions) => SegmentPlacement[]
  /** The segment playing on one track at `timeMs`. */
  getSegmentAt: (trackId: string, timeMs: number) => SegmentUnion | undefined
  /**
   * Bounded empty stretches on a track, in order. The open range after the last
   * segment is not a gap — nothing bounds it.
   */
  getTrackGaps: (trackId: string) => TrackGap[]
  /** The segments either side of one, on its own track. */
  getAdjacentSegments: (segmentId: string) => SegmentNeighbours
  /** Segments of one track (or every track) that share time, which is invalid. */
  getOverlaps: (trackId?: string) => SegmentOverlap[]
  /**
   * A property's effective value at a moment, and whether it came from a
   * keyframe, an interpolation between two, the segment's static field, or the
   * documented default. Uses the same pure sampler as the renderer and export.
   */
  sampleProperty: (segmentId: string, property: IKeyframeProperty, timeMs: number) => SampledProperty | undefined
  /** The current selection, resolved against the protocol. */
  getSelection: () => EditorSelection
  /** Semantic history entries without internal Immer patches. */
  getOperationLog: () => ProtocolManager['operationLog']['value']
  /** Whether a command would do anything right now, and why not when it would not. */
  canRun: (check: CommandCheck) => CommandCheckResult
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
  register: (pluginCreator: EditorCorePluginCreator, options?: { autoInit?: boolean, override?: boolean }) => Promise<void>
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
