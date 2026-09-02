import type { ITextSegment, IVideoProtocol } from '@video-editor/shared'
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

const textSegment: ITextSegment = {
  id: '',
  segmentType: 'text',
  startTime: 0,
  endTime: 1000,
  texts: [{ content: 'proposal' }],
}

function createEditor() {
  let segmentIndex = 0
  let trackIndex = 0
  return createEditorCore({
    protocol: structuredClone(baseProtocol),
    idFactory: {
      segment: () => `segment-${++segmentIndex}`,
      track: () => `track-${++trackIndex}`,
    },
  })
}

describe('proposal review flow', () => {
  it('builds a valid preview without touching the main protocol or history', () => {
    const editor = createEditor()

    const result = editor.proposals.create((preview) => {
      preview.commands.setFps(24)
      preview.commands.addSegment({ ...textSegment })
    }, { id: 'proposal-1' })

    expect(result.success).toBe(true)
    expect(result.proposal).toMatchObject({
      id: 'proposal-1',
      baseRevision: 0,
      validation: { valid: true },
      operations: [
        { label: 'set-fps', data: { fps: 24 } },
        { label: 'add-segment' },
      ],
      summary: {
        addedTrackIds: ['track-1'],
        addedSegmentIds: ['segment-1'],
        projectFields: ['fps'],
      },
    })
    expect(result.proposal?.previewProtocol.fps).toBe(24)
    expect(editor.state.protocol.value).toEqual(baseProtocol)
    expect(editor.state.undoCount.value).toBe(0)
    expect(editor.state.redoCount.value).toBe(0)
    expect(editor.state.revision.value).toBe(0)
  })

  it('returns detached proposal data', () => {
    const editor = createEditor()
    const result = editor.proposals.create((preview) => {
      preview.commands.setFps(24)
    }, { id: 'proposal-1' })

    result.proposal!.previewProtocol.fps = 60

    expect(editor.proposals.get('proposal-1')?.previewProtocol.fps).toBe(24)
  })

  it('rejects by discarding the preview without changing history', () => {
    const editor = createEditor()
    editor.proposals.create((preview) => {
      preview.commands.setFps(24)
    }, { id: 'proposal-1' })

    expect(editor.proposals.reject('proposal-1').success).toBe(true)
    expect(editor.proposals.list()).toEqual([])
    expect(editor.state.videoBasicInfo.fps).toBe(30)
    expect(editor.state.undoCount.value).toBe(0)
    expect(editor.state.redoCount.value).toBe(0)
    expect(editor.state.revision.value).toBe(0)
  })

  it('accepts all preview changes as one semantic history item', () => {
    const editor = createEditor()
    editor.proposals.create((preview) => {
      preview.commands.setFps(24)
      preview.commands.addSegment({ ...textSegment })
    }, { id: 'proposal-1' })

    const result = editor.proposals.accept('proposal-1')

    expect(result.success).toBe(true)
    expect(editor.state.videoBasicInfo.fps).toBe(24)
    expect(editor.state.protocol.value.tracks[0]?.children[0]?.id).toBe('segment-1')
    expect(editor.state.undoCount.value).toBe(1)
    expect(editor.state.revision.value).toBe(1)
    expect(editor.state.operationLog.value).toEqual([{
      index: 0,
      status: 'applied',
      meta: {
        label: 'accept-proposal',
        data: { proposalId: 'proposal-1', baseRevision: 0 },
      },
      operations: [
        { label: 'set-fps', data: { fps: 24 } },
        {
          label: 'add-segment',
          data: { segmentId: 'segment-1', segmentType: 'text', trackId: undefined },
        },
      ],
    }])

    editor.commands.undo()
    expect(editor.state.protocol.value).toEqual(baseProtocol)
    expect(editor.state.undoCount.value).toBe(0)
  })

  it('does not overwrite main changes made during review', () => {
    const editor = createEditor()
    editor.proposals.create((preview) => {
      preview.commands.setFps(24)
    }, { id: 'proposal-1' })

    editor.commands.setCanvasSize({ width: 1080, height: 1920 })
    const undoBefore = editor.state.undoCount.value
    const result = editor.proposals.accept('proposal-1')

    expect(result).toEqual({
      success: false,
      error: 'proposal proposal-1 conflicts with the current protocol revision',
    })
    expect(editor.state.videoBasicInfo.width).toBe(1080)
    expect(editor.state.videoBasicInfo.height).toBe(1920)
    expect(editor.state.videoBasicInfo.fps).toBe(30)
    expect(editor.state.undoCount.value).toBe(undoBefore)
    expect(editor.proposals.get('proposal-1')).toBeDefined()
  })

  it('does not store failed or empty proposal builds', () => {
    const editor = createEditor()

    const failed = editor.proposals.create(() => {
      throw new Error('agent command failed')
    }, { id: 'proposal-1' })
    const empty = editor.proposals.create((preview) => {
      preview.commands.setFps(30)
    }, { id: 'proposal-2' })

    expect(failed).toEqual({ success: false, error: 'agent command failed' })
    expect(empty).toEqual({ success: false, error: 'proposal must change the protocol' })
    expect(editor.proposals.list()).toEqual([])
  })
})
