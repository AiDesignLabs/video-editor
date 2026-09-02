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
  fromTime: 100,
  playRate: 2,
  reversed: true,
  type: 'video',
  url: 'https://example.com/original.mp4',
  opacity: 0.8,
  keyframes: [{
    property: 'opacity',
    frames: [
      { timeMs: 0, value: 1 },
      { timeMs: 900, value: 0 },
    ],
  }],
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

describe('replaceSegmentAsset', () => {
  it('preserves a compatible source window and is undoable', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...videoSegment, endTime: 500 }).id
    const undoBefore = editor.state.undoCount.value
    const input = {
      segmentId: id,
      asset: { kind: 'video' as const, url: 'https://example.com/replacement.mp4', durationMs: 1200 },
      strategy: 'preserve' as const,
    }

    expect(editor.selectors.canRun({ command: 'replaceSegmentAsset', input })).toEqual({ ok: true })
    expect(editor.commands.replaceSegmentAsset(input).success).toBe(true)

    const replaced = editor.selectors.getSegment(id, 'frames')
    expect(replaced).toMatchObject({
      url: input.asset.url,
      startTime: 0,
      endTime: 500,
      fromTime: 100,
      playRate: 2,
      reversed: true,
      opacity: 0.8,
    })
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)
    expect(editor.state.operationLog.value.at(-1)?.meta?.label).toBe('replace-segment-asset')

    editor.commands.undo()
    expect(editor.selectors.getSegment(id, 'frames')?.url).toBe(videoSegment.url)
  })

  it('rejects preserve when the current source window does not fit', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...videoSegment, endTime: 500 }).id
    const undoBefore = editor.state.undoCount.value
    const input = {
      segmentId: id,
      asset: { kind: 'video' as const, url: 'https://example.com/short.mp4', durationMs: 1000 },
      strategy: 'preserve' as const,
    }

    expect(editor.selectors.canRun({ command: 'replaceSegmentAsset', input })).toEqual({
      ok: false,
      reason: 'current source window ends at 1100ms, beyond the 1000ms asset',
    })
    expect(editor.commands.replaceSegmentAsset(input)).toMatchObject({
      success: false,
      error: 'current source window ends at 1100ms, beyond the 1000ms asset',
    })
    expect(editor.selectors.getSegment(id, 'frames')?.url).toBe(videoSegment.url)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('fits the full source, rebuilds the main track and clamps dependent timing', () => {
    const editor = createEditor()
    const firstId = editor.commands.addSegment({ ...videoSegment }).id
    editor.commands.setCurrentTime(1000)
    const secondId = editor.commands.addSegment({ ...videoSegment }).id
    editor.commands.addTransition({ id: 'fade', name: 'Fade', duration: 600 }, 1000)
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.replaceSegmentAsset({
      segmentId: firstId,
      asset: { kind: 'video', url: 'https://example.com/short.mp4', durationMs: 400 },
      strategy: 'fit',
    })

    expect(result.success).toBe(true)
    expect(editor.selectors.getSegment(firstId, 'frames')).toMatchObject({
      url: 'https://example.com/short.mp4',
      startTime: 0,
      endTime: 400,
    })
    expect(editor.selectors.getSegment(firstId, 'frames')).not.toHaveProperty('fromTime')
    expect(editor.selectors.getSegment(firstId, 'frames')).not.toHaveProperty('playRate')
    expect(editor.selectors.getSegment(firstId, 'frames')).not.toHaveProperty('reversed')
    expect(editor.selectors.getSegment(firstId, 'frames')?.keyframes?.[0]?.frames.map(frame => frame.timeMs)).toEqual([0, 400])
    expect(editor.selectors.getSegment(secondId, 'frames')).toMatchObject({ startTime: 400, endTime: 1400 })
    expect(editor.commands.exportProtocol().transitions?.[0]?.duration).toBe(400)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()
    expect(editor.selectors.getSegment(firstId, 'frames')).toMatchObject({ endTime: 1000, fromTime: 100, playRate: 2, reversed: true })
    expect(editor.selectors.getSegment(secondId, 'frames')).toMatchObject({ startTime: 1000, endTime: 2000 })
    expect(editor.commands.exportProtocol().transitions?.[0]?.duration).toBe(600)
  })

  it('rejects incompatible media types without creating history', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...videoSegment }).id
    const undoBefore = editor.state.undoCount.value
    const input = {
      segmentId: id,
      asset: { kind: 'audio' as const, url: 'https://example.com/audio.mp3', durationMs: 1000 },
      strategy: 'fit' as const,
    }

    expect(editor.selectors.canRun({ command: 'replaceSegmentAsset', input })).toEqual({
      ok: false,
      reason: 'cannot replace video with audio',
    })
    expect(editor.commands.replaceSegmentAsset(input)).toMatchObject({
      success: false,
      error: 'cannot replace video with audio',
    })
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })
})
