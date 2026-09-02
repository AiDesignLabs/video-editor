import type { IKeyframeEasing, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createEditorCore } from './core'

const baseProtocol: IVideoProtocol = {
  id: 'protocol-1',
  version: '1.0.0',
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
  transitions: [],
}

const videoSegment: IVideoFramesSegment = {
  id: '',
  segmentType: 'frames',
  startTime: 0,
  endTime: 1000,
  fromTime: 0,
  type: 'video',
  url: 'http://example.com/video.mp4',
}

function createEditor() {
  const editor = createEditorCore({ protocol: structuredClone(baseProtocol) })
  const segmentId = editor.commands.addSegment({ ...videoSegment }).id
  return { editor, segmentId }
}

describe('keyframe commands', () => {
  it('inserts sorted frames and updates an existing frame', () => {
    const { editor, segmentId } = createEditor()

    expect(editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 800, value: 0.2 }).success).toBe(true)
    expect(editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 200, value: 0.8 }).success).toBe(true)
    expect(editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 200, value: 0.5 }).success).toBe(true)

    expect(editor.selectors.getSegment(segmentId)?.keyframes).toEqual([{
      property: 'opacity',
      frames: [
        { timeMs: 200, value: 0.5 },
        { timeMs: 800, value: 0.2 },
      ],
    }])
  })

  it('stores caller-owned easing data by value and supports clearing it', () => {
    const { editor, segmentId } = createEditor()
    const easing: [number, number, number, number] = [0.42, 0, 0.58, 1]

    editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 200, value: 0.5, easing })
    easing[0] = 0.9

    expect(editor.selectors.getSegment(segmentId)?.keyframes?.[0]?.frames[0]?.easing)
      .toEqual([0.42, 0, 0.58, 1])

    expect(editor.commands.setKeyframeEasing({
      segmentId,
      property: 'opacity',
      timeMs: 200,
      easing: 'easeInOut',
    }).success).toBe(true)
    expect(editor.selectors.getSegment(segmentId)?.keyframes?.[0]?.frames[0]?.easing).toBe('easeInOut')

    expect(editor.commands.setKeyframeEasing({ segmentId, property: 'opacity', timeMs: 200 }).success).toBe(true)
    expect(editor.selectors.getSegment(segmentId)?.keyframes?.[0]?.frames[0]?.easing).toBeUndefined()
  })

  it('moves a frame as one undoable edit', () => {
    const { editor, segmentId } = createEditor()
    editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 200, value: 0.5 })
    const undoBefore = editor.state.undoCount.value

    expect(editor.commands.moveKeyframe({
      segmentId,
      property: 'opacity',
      timeMs: 200,
      toTimeMs: 600,
    })).toEqual({ success: true })
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)
    expect(editor.selectors.getSegment(segmentId)?.keyframes?.[0]?.frames[0]?.timeMs).toBe(600)

    editor.commands.undo()
    expect(editor.selectors.getSegment(segmentId)?.keyframes?.[0]?.frames[0]?.timeMs).toBe(200)
    editor.commands.redo()
    expect(editor.selectors.getSegment(segmentId)?.keyframes?.[0]?.frames[0]?.timeMs).toBe(600)
  })

  it('rejects moving onto another frame without changing state or history', () => {
    const { editor, segmentId } = createEditor()
    editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 200, value: 0.5 })
    editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 600, value: 0.8 })
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.moveKeyframe({
      segmentId,
      property: 'opacity',
      timeMs: 200,
      toTimeMs: 600,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
    expect(editor.state.undoCount.value).toBe(undoBefore)
    expect(editor.selectors.getSegment(segmentId)?.keyframes?.[0]?.frames.map(frame => frame.timeMs))
      .toEqual([200, 600])
  })

  it('removes empty property tracks and the empty keyframes field', () => {
    const { editor, segmentId } = createEditor()
    editor.commands.upsertKeyframe({ segmentId, property: 'opacity', timeMs: 200, value: 0.5 })

    expect(editor.commands.removeKeyframe({ segmentId, property: 'opacity', timeMs: 200 }))
      .toEqual({ success: true })
    expect(editor.selectors.getSegment(segmentId)?.keyframes).toBeUndefined()

    const repeated = editor.commands.removeKeyframe({ segmentId, property: 'opacity', timeMs: 200 })
    expect(repeated.success).toBe(false)
    expect(repeated.error).toContain('no opacity keyframe')
  })

  it('rejects invalid times, values, easing, properties, and segment ids', () => {
    const { editor, segmentId } = createEditor()
    const undoBefore = editor.state.undoCount.value
    const invalidEasing: IKeyframeEasing = [0, Number.NaN, 1, 1]

    const checks = [
      { command: 'upsertKeyframe' as const, input: { segmentId: 'missing', property: 'opacity' as const, timeMs: 0, value: 1 } },
      { command: 'upsertKeyframe' as const, input: { segmentId, property: 'opacity' as const, timeMs: 1001, value: 1 } },
      { command: 'upsertKeyframe' as const, input: { segmentId, property: 'opacity' as const, timeMs: 0, value: Number.NaN } },
      { command: 'upsertKeyframe' as const, input: { segmentId, property: 'intensity' as const, timeMs: 0, value: 1 } },
      { command: 'upsertKeyframe' as const, input: { segmentId, property: 'opacity' as const, timeMs: 0, value: 1, easing: invalidEasing } },
    ]

    for (const check of checks) {
      expect(editor.selectors.canRun(check).ok).toBe(false)
      expect(editor.commands.upsertKeyframe(check.input).success).toBe(false)
    }
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('keeps canRun consistent with each command', () => {
    const { editor, segmentId } = createEditor()
    const upsert = { segmentId, property: 'opacity' as const, timeMs: 200, value: 0.5 }
    expect(editor.selectors.canRun({ command: 'upsertKeyframe', input: upsert }).ok).toBe(true)
    expect(editor.commands.upsertKeyframe(upsert).success).toBe(true)

    const easing = { segmentId, property: 'opacity' as const, timeMs: 200, easing: 'easeOut' as const }
    expect(editor.selectors.canRun({ command: 'setKeyframeEasing', input: easing }).ok).toBe(true)
    expect(editor.commands.setKeyframeEasing(easing).success).toBe(true)

    const move = { segmentId, property: 'opacity' as const, timeMs: 200, toTimeMs: 400 }
    expect(editor.selectors.canRun({ command: 'moveKeyframe', input: move }).ok).toBe(true)
    expect(editor.commands.moveKeyframe(move).success).toBe(true)

    const remove = { segmentId, property: 'opacity' as const, timeMs: 400 }
    expect(editor.selectors.canRun({ command: 'removeKeyframe', input: remove }).ok).toBe(true)
    expect(editor.commands.removeKeyframe(remove).success).toBe(true)
  })
})
