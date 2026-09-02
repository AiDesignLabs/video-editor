import type { IKeyframeEasing, IKeyframeProperty, SegmentUnion } from '@video-editor/shared'
import type {
  CommandCheckResult,
  EditorCoreCommands,
  KeyframeCommandCheck,
  KeyframeCommandResult,
  MoveKeyframeOptions,
  RemoveKeyframeOptions,
  SetKeyframeEasingOptions,
  UpsertKeyframeOptions,
} from './types'

type ReadableEasing = Exclude<IKeyframeEasing, [number, number, number, number]>
  | readonly [number, number, number, number]

interface ReadableKeyframe {
  readonly timeMs: number
  readonly value: number
  readonly easing?: ReadableEasing
}

interface ReadableKeyframeSegment {
  readonly segmentType: SegmentUnion['segmentType']
  readonly type?: string
  readonly startTime: number
  readonly endTime: number
  readonly keyframes?: readonly {
    readonly property: IKeyframeProperty
    readonly frames: readonly ReadableKeyframe[]
  }[]
}

type GetKeyframeSegment = (segmentId: string) => ReadableKeyframeSegment | undefined

interface KeyframeCommandDeps {
  getSegment: GetKeyframeSegment
  updateSegment: EditorCoreCommands['updateSegment']
}

const NAMED_EASINGS = new Set<string>(['linear', 'easeIn', 'easeOut', 'easeInOut'])

function refused(reason: string): CommandCheckResult {
  return { ok: false, reason }
}

function isEasingValid(easing: IKeyframeEasing | undefined): boolean {
  if (easing === undefined)
    return true
  if (typeof easing === 'string')
    return NAMED_EASINGS.has(easing)
  return easing.length === 4 && easing.every(Number.isFinite)
}

function easingEquals(a: ReadableEasing | undefined, b: ReadableEasing | undefined): boolean {
  if (a === b)
    return true
  if (!Array.isArray(a) || !Array.isArray(b))
    return false
  return a.every((value, index) => value === b[index])
}

function cloneEasing(easing: IKeyframeEasing): IKeyframeEasing {
  return Array.isArray(easing) ? [...easing] : easing
}

function supportsProperty(segment: ReadableKeyframeSegment, property: IKeyframeProperty): boolean {
  if (property === 'opacity')
    return segment.segmentType === 'frames' || segment.segmentType === 'text'
  if (property === 'volume')
    return segment.segmentType === 'audio' || (segment.segmentType === 'frames' && segment.type === 'video')
  if (property === 'intensity')
    return segment.segmentType === 'filter'
  return segment.segmentType === 'frames' || segment.segmentType === 'text' || segment.segmentType === 'sticker'
}

function findFrame(segment: ReadableKeyframeSegment, property: IKeyframeProperty, timeMs: number): ReadableKeyframe | undefined {
  const track = segment.keyframes?.find(track => track.property === property)
  return track?.frames.find(frame => frame.timeMs === timeMs)
}

function checkCommon(
  getSegment: GetKeyframeSegment,
  input: { segmentId: string, property: IKeyframeProperty, timeMs: number },
): CommandCheckResult {
  const segment = getSegment(input.segmentId)
  if (!segment)
    return refused(`no segment with id ${input.segmentId}`)
  if (!supportsProperty(segment, input.property))
    return refused(`${input.property} keyframes are not supported by this segment`)
  if (!Number.isFinite(input.timeMs))
    return refused('keyframe time must be a finite number')
  const duration = segment.endTime - segment.startTime
  if (input.timeMs < 0 || input.timeMs > duration)
    return refused(`keyframe time must be between 0 and ${duration}`)
  return { ok: true }
}

export function checkKeyframeCommand(
  check: KeyframeCommandCheck,
  getSegment: GetKeyframeSegment,
): CommandCheckResult {
  const common = checkCommon(getSegment, check.input)
  if (!common.ok)
    return common

  const segment = getSegment(check.input.segmentId)!
  const frame = findFrame(segment, check.input.property, check.input.timeMs)

  switch (check.command) {
    case 'upsertKeyframe': {
      const { input } = check
      if (!Number.isFinite(input.value))
        return refused('keyframe value must be a finite number')
      if (!isEasingValid(input.easing))
        return refused('keyframe easing is invalid')
      if (frame && frame.value === input.value && (input.easing === undefined || easingEquals(frame.easing, input.easing)))
        return refused('keyframe already has the requested value')
      return { ok: true }
    }

    case 'moveKeyframe': {
      const { input } = check
      if (!frame)
        return refused(`no ${input.property} keyframe at ${input.timeMs}`)
      const targetCheck = checkCommon(getSegment, { ...input, timeMs: input.toTimeMs })
      if (!targetCheck.ok)
        return targetCheck
      if (input.toTimeMs === input.timeMs)
        return refused('keyframe is already at the requested time')
      if (findFrame(segment, input.property, input.toTimeMs))
        return refused(`a ${input.property} keyframe already exists at ${input.toTimeMs}`)
      return { ok: true }
    }

    case 'removeKeyframe': {
      const { input } = check
      return frame ? { ok: true } : refused(`no ${input.property} keyframe at ${input.timeMs}`)
    }

    case 'setKeyframeEasing': {
      const { input } = check
      if (!frame)
        return refused(`no ${input.property} keyframe at ${input.timeMs}`)
      if (!isEasingValid(input.easing))
        return refused('keyframe easing is invalid')
      if (easingEquals(frame.easing, input.easing))
        return refused('keyframe already has the requested easing')
      return { ok: true }
    }
  }
}

export function createKeyframeCommands(deps: KeyframeCommandDeps) {
  function run(
    check: KeyframeCommandCheck,
    mutate: (segment: SegmentUnion) => void,
  ): KeyframeCommandResult {
    const allowed = checkKeyframeCommand(check, deps.getSegment)
    if (!allowed.ok)
      return { success: false, error: allowed.reason }

    const success = deps.updateSegment(mutate, check.input.segmentId)
    return success
      ? { success: true }
      : { success: false, error: 'the protocol rejected the keyframe edit' }
  }

  return {
    upsertKeyframe(input: UpsertKeyframeOptions): KeyframeCommandResult {
      return run({ command: 'upsertKeyframe', input }, (segment) => {
        const tracks = segment.keyframes ?? (segment.keyframes = [])
        let track = tracks.find(item => item.property === input.property)
        if (!track) {
          track = { property: input.property, frames: [] }
          tracks.push(track)
        }
        const existing = track.frames.find(frame => frame.timeMs === input.timeMs)
        if (existing) {
          existing.value = input.value
          if (input.easing !== undefined)
            existing.easing = cloneEasing(input.easing)
        }
        else {
          track.frames.push({
            timeMs: input.timeMs,
            value: input.value,
            ...(input.easing === undefined ? {} : { easing: cloneEasing(input.easing) }),
          })
          track.frames.sort((a, b) => a.timeMs - b.timeMs)
        }
      })
    },

    moveKeyframe(input: MoveKeyframeOptions): KeyframeCommandResult {
      return run({ command: 'moveKeyframe', input }, (segment) => {
        const track = segment.keyframes!.find(item => item.property === input.property)!
        const frame = track.frames.find(item => item.timeMs === input.timeMs)!
        frame.timeMs = input.toTimeMs
        track.frames.sort((a, b) => a.timeMs - b.timeMs)
      })
    },

    removeKeyframe(input: RemoveKeyframeOptions): KeyframeCommandResult {
      return run({ command: 'removeKeyframe', input }, (segment) => {
        const tracks = segment.keyframes!
        const trackIndex = tracks.findIndex(item => item.property === input.property)
        const track = tracks[trackIndex]!
        const frameIndex = track.frames.findIndex(frame => frame.timeMs === input.timeMs)
        track.frames.splice(frameIndex, 1)
        if (!track.frames.length)
          tracks.splice(trackIndex, 1)
        if (!tracks.length)
          delete segment.keyframes
      })
    },

    setKeyframeEasing(input: SetKeyframeEasingOptions): KeyframeCommandResult {
      return run({ command: 'setKeyframeEasing', input }, (segment) => {
        const track = segment.keyframes!.find(item => item.property === input.property)!
        const frame = track.frames.find(item => item.timeMs === input.timeMs)!
        if (input.easing === undefined)
          delete frame.easing
        else
          frame.easing = cloneEasing(input.easing)
      })
    },
  }
}
