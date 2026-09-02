import type {
  IKeyframeProperty,
  IKeyframeTrack,
  ITrackType,
  IVideoProtocol,
  SegmentUnion,
  TrackUnion,
} from '@video-editor/shared'
import type {
  CommandCheck,
  CommandCheckResult,
  EditorSelection,
  SampledProperty,
  SegmentNeighbours,
  SegmentOverlap,
  SegmentPlacement,
  SegmentsAtOptions,
  TrackGap,
} from './types'
import { MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, MIN_FPS } from '@video-editor/protocol'
import { isAudioSegment, isVideoFramesSegment, sampleKeyframes } from '@video-editor/shared'
import { checkKeyframeCommand } from './keyframes'

/**
 * How a keyframe property falls back when the segment has no curve for it.
 * These mirror what the renderer draws, so a query and the picture agree.
 */
const PROPERTY_DEFAULTS: Record<IKeyframeProperty, number> = {
  'opacity': 1,
  'position.x': 0,
  'position.y': 0,
  'scale': 1,
  'rotation': 0,
  'volume': 1,
  'intensity': 1,
}

const TRACK_TYPES = new Set<ITrackType>(['frames', 'text', 'sticker', 'audio', 'effect', 'filter'])

interface TransformLike {
  position?: readonly number[]
  rotation?: readonly number[]
  scale?: readonly number[]
}

/** The static value a property falls back to, or undefined when unset. */
function readStaticProperty(segment: SegmentUnion, property: IKeyframeProperty): number | undefined {
  const loose = segment as unknown as {
    opacity?: number
    volume?: number
    intensity?: number
    transform?: TransformLike
  }
  const transform = loose.transform

  switch (property) {
    case 'opacity':
      return loose.opacity
    case 'volume':
      return loose.volume
    case 'intensity':
      return loose.intensity
    case 'position.x':
      return transform?.position?.[0]
    case 'position.y':
      return transform?.position?.[1]
    case 'scale':
      return transform?.scale?.[0]
    case 'rotation':
      return transform?.rotation?.[2]
  }
}

function findKeyframeTrack(segment: SegmentUnion, property: IKeyframeProperty): IKeyframeTrack | undefined {
  return segment.keyframes?.find(track => track.property === property && track.frames.length > 0)
}

function coversTime(segment: SegmentUnion, timeMs: number): boolean {
  // Half-open: a segment ending at t and the one starting at t do not both play.
  return timeMs >= segment.startTime && timeMs < segment.endTime
}

/** Segments in timeline order; the protocol keeps tracks sorted, but not defensively. */
function orderedChildren(track: TrackUnion): SegmentUnion[] {
  return [...track.children].sort((a, b) => a.startTime - b.startTime)
}

export interface StructuralSelectorDeps {
  protocol: () => IVideoProtocol
  selectedSegmentId: () => string | undefined
  undoCount: () => number
  redoCount: () => number
}

/**
 * Read-only queries over the protocol.
 *
 * An agent has to understand the timeline before it can edit it. Without these
 * it would have to parse the whole protocol itself, which means implementing
 * the timeline rules a second time — and the two copies would drift.
 */
export function createStructuralSelectors(deps: StructuralSelectorDeps) {
  const { protocol, selectedSegmentId, undoCount, redoCount } = deps

  const findTrackOf = (segmentId: string): TrackUnion | undefined =>
    protocol().tracks.find(track => track.children.some(segment => segment.id === segmentId))

  const findSegment = (segmentId: string): SegmentUnion | undefined => {
    for (const track of protocol().tracks) {
      const segment = track.children.find(item => item.id === segmentId)
      if (segment)
        return segment
    }
    return undefined
  }

  const mainFramesTrack = (): TrackUnion | undefined =>
    protocol().tracks.find(track => track.trackType === 'frames' && (track as { isMain?: boolean }).isMain)

  function getSegmentsAt(timeMs: number, options?: SegmentsAtOptions): SegmentPlacement[] {
    const found: SegmentPlacement[] = []
    for (const track of protocol().tracks) {
      if (options?.trackType && track.trackType !== options.trackType)
        continue
      if (options?.includeHidden === false && (track as { hidden?: boolean }).hidden)
        continue
      for (const segment of track.children) {
        if (coversTime(segment, timeMs))
          found.push({ segment, trackId: track.trackId, trackType: track.trackType })
      }
    }
    return found
  }

  function getSegmentAt(trackId: string, timeMs: number): SegmentUnion | undefined {
    const track = protocol().tracks.find(item => item.trackId === trackId)
    return track?.children.find(segment => coversTime(segment, timeMs))
  }

  function getTrackGaps(trackId: string): TrackGap[] {
    const track = protocol().tracks.find(item => item.trackId === trackId)
    if (!track)
      return []

    const gaps: TrackGap[] = []
    let cursor = 0
    for (const segment of orderedChildren(track)) {
      if (segment.startTime > cursor)
        gaps.push({ startTime: cursor, endTime: segment.startTime })
      // Overlapping segments must not rewind the cursor into a fake gap.
      cursor = Math.max(cursor, segment.endTime)
    }
    // The open range after the last segment is not a gap: nothing bounds it.
    return gaps
  }

  function getAdjacentSegments(segmentId: string): SegmentNeighbours {
    const track = findTrackOf(segmentId)
    if (!track)
      return {}
    const ordered = orderedChildren(track)
    const index = ordered.findIndex(segment => segment.id === segmentId)
    if (index < 0)
      return {}
    return {
      trackId: track.trackId,
      previous: ordered[index - 1],
      next: ordered[index + 1],
    }
  }

  function getOverlaps(trackId?: string): SegmentOverlap[] {
    const tracks = trackId
      ? protocol().tracks.filter(track => track.trackId === trackId)
      : protocol().tracks

    const overlaps: SegmentOverlap[] = []
    for (const track of tracks) {
      const ordered = orderedChildren(track)
      for (let i = 0; i < ordered.length - 1; i++) {
        const current = ordered[i]
        for (let j = i + 1; j < ordered.length; j++) {
          const next = ordered[j]
          if (next.startTime >= current.endTime)
            break
          overlaps.push({
            trackId: track.trackId,
            a: current,
            b: next,
            startTime: next.startTime,
            endTime: Math.min(current.endTime, next.endTime),
          })
        }
      }
    }
    return overlaps
  }

  function sampleProperty(
    segmentId: string,
    property: IKeyframeProperty,
    timeMs: number,
  ): SampledProperty | undefined {
    const segment = findSegment(segmentId)
    if (!segment)
      return undefined

    const withinSegment = coversTime(segment, timeMs)
    const track = findKeyframeTrack(segment, property)

    if (track) {
      // The same pure sampler the renderer and the exporter use, so a query
      // cannot disagree with the picture.
      const relMs = Math.max(0, timeMs - segment.startTime)
      const value = sampleKeyframes(track, relMs)
      if (Number.isFinite(value)) {
        const frames = track.frames
        // A value held at an endpoint, or from a lone keyframe, comes straight
        // off a frame — it is not time-dependent here, and calling it
        // interpolated would tell a reviewer the opposite.
        const held = frames.length === 1
          || relMs <= frames[0].timeMs
          || relMs >= frames[frames.length - 1].timeMs
        const onFrame = held || frames.some(frame => frame.timeMs === relMs)
        return {
          value,
          source: onFrame ? 'keyframe' : 'interpolated',
          withinSegment,
        }
      }
    }

    const staticValue = readStaticProperty(segment, property)
    if (staticValue !== undefined && Number.isFinite(staticValue))
      return { value: staticValue, source: 'static', withinSegment }

    return { value: PROPERTY_DEFAULTS[property], source: 'default', withinSegment }
  }

  function getSelection(): EditorSelection {
    const segmentId = selectedSegmentId()
    if (!segmentId)
      return {}
    const segment = findSegment(segmentId)
    if (!segment)
      return {}
    return { segmentId, segment, trackId: findTrackOf(segmentId)?.trackId }
  }

  const allowed: CommandCheckResult = { ok: true }
  const refused = (reason: string): CommandCheckResult => ({ ok: false, reason })

  /**
   * Whether a command would do anything right now, and why not when it would
   * not. A UI uses it to disable a button; an agent uses it to avoid proposing
   * an edit the protocol will refuse.
   */
  function canRun(check: CommandCheck): CommandCheckResult {
    switch (check.command) {
      case 'undo':
        return undoCount() > 0 ? allowed : refused('nothing to undo')

      case 'redo':
        return redoCount() > 0 ? allowed : refused('nothing to redo')

      case 'removeSegment':
      case 'duplicateSegment': {
        return findSegment(check.segmentId)
          ? allowed
          : refused(`no segment with id ${check.segmentId}`)
      }

      case 'splitSegment': {
        const segment = findSegment(check.segmentId)
        if (!segment)
          return refused(`no segment with id ${check.segmentId}`)
        if (!Number.isFinite(check.timelineMs))
          return refused('split time must be a finite number')
        if (check.timelineMs <= segment.startTime || check.timelineMs >= segment.endTime)
          return refused('split time must fall strictly inside the segment')
        return allowed
      }

      case 'addTransition': {
        const track = mainFramesTrack()
        if (!track)
          return refused('the project has no main frames track')
        if (track.children.length < 2)
          return refused('a transition needs two adjacent segments')
        return allowed
      }

      case 'setCanvasSize': {
        for (const [label, value] of [['width', check.width], ['height', check.height]] as const) {
          if (!Number.isInteger(value))
            return refused(`${label} must be a whole number of pixels`)
          if (value < MIN_CANVAS_SIZE || value > MAX_CANVAS_SIZE)
            return refused(`${label} must be between ${MIN_CANVAS_SIZE} and ${MAX_CANVAS_SIZE}`)
        }
        return allowed
      }

      case 'setFps': {
        if (!Number.isFinite(check.fps))
          return refused('fps must be a finite number')
        if (check.fps < MIN_FPS)
          return refused(`fps must be at least ${MIN_FPS}`)
        return allowed
      }

      case 'addTrack': {
        const { input } = check
        if (!TRACK_TYPES.has(input.trackType))
          return refused(`unsupported track type ${String(input.trackType)}`)
        if (input.trackId !== undefined && (typeof input.trackId !== 'string' || input.trackId.length === 0))
          return refused('track id must not be empty')
        if (input.trackId && protocol().tracks.some(track => track.trackId === input.trackId))
          return refused(`track id ${input.trackId} already exists`)
        const index = input.index ?? 0
        if (!Number.isInteger(index) || index < 0 || index > protocol().tracks.length)
          return refused(`track index must be between 0 and ${protocol().tracks.length}`)
        return allowed
      }

      case 'removeTrack':
        return protocol().tracks.some(track => track.trackId === check.trackId)
          ? allowed
          : refused(`no track with id ${check.trackId}`)

      case 'moveTrack': {
        const tracks = protocol().tracks
        if (!tracks.some(track => track.trackId === check.trackId))
          return refused(`no track with id ${check.trackId}`)
        if (!Number.isInteger(check.toIndex) || check.toIndex < 0 || check.toIndex >= tracks.length)
          return refused(`track index must be between 0 and ${Math.max(0, tracks.length - 1)}`)
        return allowed
      }

      case 'replaceSegmentAsset': {
        const { asset, segmentId, strategy } = check.input
        const segment = findSegment(segmentId)
        if (!segment)
          return refused(`no segment with id ${segmentId}`)
        const currentKind = isVideoFramesSegment(segment)
          ? 'video'
          : isAudioSegment(segment)
            ? 'audio'
            : segment.segmentType === 'sticker' || (segment.segmentType === 'frames' && segment.type === 'image')
              ? 'image'
              : undefined
        if (!currentKind)
          return refused('segment does not use a replaceable asset')
        if (currentKind !== asset.kind)
          return refused(`cannot replace ${currentKind} with ${asset.kind}`)
        if (asset.id !== undefined && !asset.id)
          return refused('asset id must not be empty')
        try {
          if (!new URL(asset.url).protocol)
            return refused('asset url must be an absolute URL')
        }
        catch {
          return refused('asset url must be an absolute URL')
        }
        if (strategy !== 'preserve' && strategy !== 'fit')
          return refused(`unsupported replacement strategy ${String(strategy)}`)
        if (currentKind === 'image')
          return strategy === 'fit' ? refused('fit strategy requires a video or audio asset with a duration') : allowed
        if (typeof asset.durationMs !== 'number' || !Number.isFinite(asset.durationMs) || asset.durationMs <= 0)
          return refused('asset durationMs must be a positive number for video and audio')
        if (strategy === 'preserve') {
          const timed = segment as { startTime: number, endTime: number, fromTime?: number, playRate?: number }
          const sourceEnd = (timed.fromTime ?? 0) + (timed.endTime - timed.startTime) * (timed.playRate ?? 1)
          if (sourceEnd > asset.durationMs)
            return refused(`current source window ends at ${sourceEnd}ms, beyond the ${asset.durationMs}ms asset`)
        }
        return allowed
      }

      case 'upsertKeyframe':
      case 'moveKeyframe':
      case 'removeKeyframe':
      case 'setKeyframeEasing':
        return checkKeyframeCommand(check, findSegment)
    }
  }

  return {
    getSegmentsAt,
    getSegmentAt,
    getTrackGaps,
    getAdjacentSegments,
    getOverlaps,
    sampleProperty,
    getSelection,
    canRun,
  }
}
