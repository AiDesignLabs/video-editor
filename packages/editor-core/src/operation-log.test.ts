import type { IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
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
  return createEditorCore({ protocol: structuredClone(baseProtocol) })
}

describe('semantic operation log', () => {
  it('exposes command metadata without exposing Immer patches', () => {
    const editor = createEditor()
    const segmentId = editor.commands.addSegment({ ...videoSegment }).id

    expect(editor.state.operationLog.value).toEqual([{
      index: 0,
      status: 'applied',
      meta: {
        label: 'add-segment',
        data: { segmentId, segmentType: 'frames', trackId: undefined },
      },
      operations: [],
    }])
    expect(editor.state.operationLog.value[0]).not.toHaveProperty('patches')
    expect(editor.state.operationLog.value[0]).not.toHaveProperty('inversePatches')
  })

  it('records dedicated keyframe metadata instead of a generic segment update', () => {
    const editor = createEditor()
    const segmentId = editor.commands.addSegment({ ...videoSegment }).id

    editor.commands.upsertKeyframe({
      segmentId,
      property: 'opacity',
      timeMs: 250,
      value: 0.5,
    })

    expect(editor.state.operationLog.value.at(-1)?.meta).toEqual({
      label: 'upsert-keyframe',
      data: { segmentId, property: 'opacity', timeMs: 250, value: 0.5 },
    })
  })

  it('lists direct commands inside an outer proposal-style transaction', () => {
    const editor = createEditor()
    const segmentId = editor.commands.addSegment({ ...videoSegment }).id

    editor.commands.transaction(() => {
      editor.commands.updateSegment((segment) => {
        segment.opacity = 0.5
      }, segmentId, 'frames')
      editor.commands.setFps(24)
    }, { label: 'accept-proposal', data: { proposalId: 'proposal-1' } })

    expect(editor.state.operationLog.value.at(-1)).toEqual({
      index: 1,
      status: 'applied',
      meta: { label: 'accept-proposal', data: { proposalId: 'proposal-1' } },
      operations: [
        { label: 'update-segment', data: { segmentId } },
        { label: 'set-fps', data: { fps: 24 } },
      ],
    })
  })

  it('tracks undo status and returns detached selector data', () => {
    const editor = createEditor()
    editor.commands.setFps(24)

    const selectedLog = editor.selectors.getOperationLog()
    expect(selectedLog).not.toBe(editor.state.operationLog.value)
    expect(selectedLog[0]?.meta?.data).not.toBe(editor.state.operationLog.value[0]?.meta?.data)
    expect(editor.state.operationLog.value[0]?.meta?.data).toEqual({ fps: 24 })

    editor.commands.undo()
    expect(editor.state.operationLog.value[0]?.status).toBe('undone')
    editor.commands.redo()
    expect(editor.state.operationLog.value[0]?.status).toBe('applied')
  })

  it('does not log rejected or no-op commands', () => {
    const editor = createEditor()

    expect(editor.commands.removeTrack('missing').success).toBe(false)
    expect(editor.commands.setFps(30).success).toBe(true)
    expect(editor.state.operationLog.value).toEqual([])
  })
})
