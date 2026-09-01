import type { ITextSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
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

const framesSegment: IVideoFramesSegment = {
  id: '',
  segmentType: 'frames',
  startTime: 0,
  endTime: 1000,
  fromTime: 0,
  type: 'video',
  url: 'http://example.com/video.mp4',
}

const textSegment: ITextSegment = {
  id: '',
  segmentType: 'text',
  startTime: 0,
  endTime: 1000,
  texts: [{ content: 'hello' }],
}

function createEditor() {
  return createEditorCore({ protocol: structuredClone(baseProtocol) })
}

/** Overlay text segments at the given start times; overlay tracks allow gaps. */
function seedOverlay(editor: ReturnType<typeof createEditor>, times: number[]) {
  return times.map((startTime) => {
    editor.commands.setCurrentTime(startTime)
    return editor.commands.addSegment({ ...textSegment, startTime, endTime: startTime + 500 }).id
  })
}

function startTimeOf(editor: ReturnType<typeof createEditor>, id: string) {
  return editor.state.segmentMap.value[id]?.startTime
}

/** `opacity` is not on every segment shape, so read it through the union. */
function opacityOf(editor: ReturnType<typeof createEditor>, id: string) {
  return (editor.state.segmentMap.value[id] as { opacity?: number } | undefined)?.opacity
}

describe('moveSegments', () => {
  it('moves every segment as one undo step', () => {
    const editor = createEditor()
    const [a, b] = seedOverlay(editor, [0, 4000])
    const trackA = editor.selectors.getTrackBySegmentId(a)!.trackId
    const trackB = editor.selectors.getTrackBySegmentId(b)!.trackId
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.moveSegments([
      { segmentId: a, sourceTrackId: trackA, startTime: 1000, endTime: 1500 },
      { segmentId: b, sourceTrackId: trackB, startTime: 5000, endTime: 5500 },
    ])

    expect(result.success).toBe(true)
    expect(result.segmentIds).toEqual([a, b])
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)
    expect(startTimeOf(editor, a)).toBe(1000)
    expect(startTimeOf(editor, b)).toBe(5000)

    editor.commands.undo()

    expect(startTimeOf(editor, a)).toBe(0)
    expect(startTimeOf(editor, b)).toBe(4000)
  })

  it('rolls the whole batch back when one move is refused', () => {
    const editor = createEditor()
    const [a, b] = seedOverlay(editor, [0, 4000])
    const trackA = editor.selectors.getTrackBySegmentId(a)!.trackId
    const snapshot = structuredClone(editor.commands.exportProtocol())
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.moveSegments([
      { segmentId: a, sourceTrackId: trackA, startTime: 1000, endTime: 1500 },
      { segmentId: 'missing', sourceTrackId: trackA, startTime: 0, endTime: 500 },
    ])

    expect(result.success).toBe(false)
    expect(result.error).toContain('missing')
    // The first move must not survive the failure of the second.
    expect(editor.commands.exportProtocol()).toEqual(snapshot)
    expect(editor.state.undoCount.value).toBe(undoBefore)
    expect(startTimeOf(editor, b)).toBe(4000)
  })

  it('records nothing for an empty batch', () => {
    const editor = createEditor()
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.moveSegments([])

    expect(result).toEqual({ success: true, segmentIds: [] })
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })
})

describe('removeSegments', () => {
  it('removes every segment as one undo step', () => {
    const editor = createEditor()
    const [a, b, c] = seedOverlay(editor, [0, 2000, 4000])
    const snapshot = structuredClone(editor.commands.exportProtocol())
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.removeSegments([a, c])

    expect(result.success).toBe(true)
    expect(editor.state.segmentMap.value[a]).toBeUndefined()
    expect(editor.state.segmentMap.value[c]).toBeUndefined()
    expect(editor.state.segmentMap.value[b]).toBeDefined()
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(editor.commands.exportProtocol()).toEqual(snapshot)
  })

  it('ripple-deletes several main track segments without losing one', () => {
    const editor = createEditor()
    const first = editor.commands.addSegment({ ...framesSegment }).id
    editor.commands.setCurrentTime(1000)
    const second = editor.commands.addSegment({ ...framesSegment }).id
    editor.commands.setCurrentTime(2000)
    const third = editor.commands.addSegment({ ...framesSegment }).id
    const undoBefore = editor.state.undoCount.value

    // Removing `first` shifts the rest left, so a batch that walked forwards
    // would be chasing moved targets.
    const result = editor.commands.removeSegments([first, second], { ripple: true })

    expect(result.success).toBe(true)
    expect(editor.state.segmentMap.value[first]).toBeUndefined()
    expect(editor.state.segmentMap.value[second]).toBeUndefined()
    expect(startTimeOf(editor, third)).toBe(0)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(startTimeOf(editor, first)).toBe(0)
    expect(startTimeOf(editor, second)).toBe(1000)
    expect(startTimeOf(editor, third)).toBe(2000)
  })

  it('rejects the batch when an id does not exist and removes nothing', () => {
    const editor = createEditor()
    const [a] = seedOverlay(editor, [0])
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.removeSegments([a, 'missing'])

    expect(result.success).toBe(false)
    expect(result.error).toContain('missing')
    expect(editor.state.segmentMap.value[a]).toBeDefined()
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('ignores duplicate ids', () => {
    const editor = createEditor()
    const [a] = seedOverlay(editor, [0])

    const result = editor.commands.removeSegments([a, a, a])

    expect(result.success).toBe(true)
    expect(result.segmentIds).toEqual([a])
  })
})

describe('updateSegments', () => {
  it('applies a common property across a selection as one undo step', () => {
    const editor = createEditor()
    const [a, b] = seedOverlay(editor, [0, 4000])
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.updateSegments([a, b], (segment) => {
      if (segment.segmentType === 'text')
        segment.opacity = 0.5
    })

    expect(result.success).toBe(true)
    expect(opacityOf(editor, a)).toBe(0.5)
    expect(opacityOf(editor, b)).toBe(0.5)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(opacityOf(editor, a)).toBeUndefined()
    expect(opacityOf(editor, b)).toBeUndefined()
  })

  it('fails the batch when the protocol rejects one of the edits', () => {
    const editor = createEditor()
    const first = editor.commands.addSegment({ ...framesSegment }).id
    editor.commands.setCurrentTime(1000)
    const second = editor.commands.addSegment({ ...framesSegment }).id
    const snapshot = structuredClone(editor.commands.exportProtocol())
    const undoBefore = editor.state.undoCount.value

    // An invalid url is rejected per segment and leaves no trace, so without
    // the batch checking each result this would report success.
    const result = editor.commands.updateSegments([first, second], (segment) => {
      if (segment.segmentType === 'frames')
        segment.url = 'not a url'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('rejected')
    expect(editor.commands.exportProtocol()).toEqual(snapshot)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('rejects unknown ids before touching anything', () => {
    const editor = createEditor()
    const [a] = seedOverlay(editor, [0])
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.updateSegments([a, 'missing'], (segment) => {
      if (segment.segmentType === 'text')
        segment.opacity = 0.25
    })

    expect(result.success).toBe(false)
    expect(opacityOf(editor, a)).toBeUndefined()
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })
})

describe('duplicateSegments', () => {
  it('duplicates every segment as one undo step and reports the new ids', () => {
    const editor = createEditor()
    const [a, b] = seedOverlay(editor, [0, 4000])
    const snapshot = structuredClone(editor.commands.exportProtocol())
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.duplicateSegments([a, b])

    expect(result.success).toBe(true)
    expect(result.segmentIds).toHaveLength(2)
    // The copies, not the sources: they are what a caller selects next.
    expect(result.segmentIds).not.toContain(a)
    expect(result.segmentIds).not.toContain(b)
    for (const id of result.segmentIds)
      expect(editor.state.segmentMap.value[id]).toBeDefined()

    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(editor.commands.exportProtocol()).toEqual(snapshot)
  })

  it('rejects the batch when an id does not exist', () => {
    const editor = createEditor()
    const [a] = seedOverlay(editor, [0])
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.duplicateSegments([a, 'missing'])

    expect(result.success).toBe(false)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })
})

describe('batch nesting', () => {
  it('joins an enclosing transaction instead of pushing its own history item', () => {
    const editor = createEditor()
    const [a, b] = seedOverlay(editor, [0, 4000])
    const snapshot = structuredClone(editor.commands.exportProtocol())
    const undoBefore = editor.state.undoCount.value

    editor.commands.transaction(() => {
      editor.commands.updateSegments([a], (segment) => {
        if (segment.segmentType === 'text')
          segment.opacity = 0.5
      })
      editor.commands.removeSegments([b])
      expect(editor.state.undoCount.value).toBe(undoBefore)
    }, { label: 'compound-edit' })

    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(editor.commands.exportProtocol()).toEqual(snapshot)
  })
})
