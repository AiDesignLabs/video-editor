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

/** Adds overlay text segments at the given start times; overlay tracks allow gaps. */
function addOverlaySegments(editor: ReturnType<typeof createEditor>, times: number[]) {
  return times.map((startTime) => {
    editor.commands.setCurrentTime(startTime)
    return editor.commands.addSegment({ ...textSegment, startTime, endTime: startTime + 1000 }).id
  })
}

describe('editor state', () => {
  it('exposes the protocol and derived duration', () => {
    const editor = createEditor()

    expect(editor.state.duration.value).toBe(0)

    editor.commands.addSegment({ ...framesSegment })

    expect(editor.state.duration.value).toBe(1000)
    expect(editor.state.protocol.value.tracks).toHaveLength(1)
  })

  it('tracks the current time and selection', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...framesSegment }).id

    editor.commands.setCurrentTime(500)
    expect(editor.state.currentTime.value).toBe(500)

    editor.commands.setSelectedSegment(id)
    expect(editor.state.selectedSegmentId.value).toBe(id)
    expect(editor.state.selectedSegment.value?.id).toBe(id)

    editor.commands.setSelectedSegment(undefined)
    expect(editor.state.selectedSegment.value).toBeUndefined()
  })

  it('reports undo and redo stack sizes', () => {
    const editor = createEditor()

    expect(editor.state.undoCount.value).toBe(0)
    expect(editor.state.redoCount.value).toBe(0)

    editor.commands.addSegment({ ...framesSegment })
    expect(editor.state.undoCount.value).toBe(1)

    editor.commands.undo()
    expect(editor.state.undoCount.value).toBe(0)
    expect(editor.state.redoCount.value).toBe(1)
  })
})

describe('segment commands', () => {
  it('adds, updates and removes a segment', () => {
    const editor = createEditor()

    const id = editor.commands.addSegment({ ...framesSegment }).id
    expect(editor.selectors.getSegment(id)?.id).toBe(id)

    editor.commands.updateSegment((segment) => {
      segment.url = 'http://example.com/other.mp4'
    }, id)
    expect(editor.state.segmentMap.value[id]?.url).toBe('http://example.com/other.mp4')

    editor.commands.removeSegment(id)
    expect(editor.state.segmentMap.value[id]).toBeUndefined()
  })

  it('updates the current selection when no id is given', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...framesSegment }).id
    editor.commands.setSelectedSegment(id)

    editor.commands.updateSegment((segment) => {
      segment.url = 'http://example.com/selected.mp4'
    })

    expect(editor.state.segmentMap.value[id]?.url).toBe('http://example.com/selected.mp4')
  })

  it('rejects an invalid edit without changing the protocol or history', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...framesSegment }).id
    const undoBefore = editor.state.undoCount.value

    editor.commands.updateSegment((segment) => {
      segment.url = 'not a url'
    }, id)

    expect(editor.state.segmentMap.value[id]?.url).toBe(framesSegment.url)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('splits a segment as a single undo step', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...framesSegment }).id
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.splitSegment(id, 500)

    expect(result.success).toBe(true)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(editor.state.segmentMap.value[id]?.endTime).toBe(1000)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('resizes a segment through the command layer', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...framesSegment }).id
    const trackId = editor.selectors.getTrackBySegmentId(id)?.trackId

    expect(trackId).toBeDefined()
    editor.commands.resizeSegment({ segmentId: id, trackId: trackId!, startTime: 0, endTime: 800 })

    expect(editor.state.segmentMap.value[id]?.endTime).toBe(800)
  })
})

describe('canvas commands', () => {
  it('resizes the canvas and restores both dimensions on undo', () => {
    const editor = createEditor()

    expect(editor.commands.setCanvasSize({ width: 1080, height: 1920 })).toEqual({ success: true })
    expect(editor.state.videoBasicInfo.width).toBe(1080)
    expect(editor.state.videoBasicInfo.height).toBe(1920)

    editor.commands.undo()

    expect(editor.state.videoBasicInfo.width).toBe(1920)
    expect(editor.state.videoBasicInfo.height).toBe(1080)
  })

  it('rejects a canvas size the encoder cannot use', () => {
    const editor = createEditor()

    const result = editor.commands.setCanvasSize({ width: 0, height: 1080 })

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(editor.state.videoBasicInfo.width).toBe(1920)
  })
})

describe('project frame rate command', () => {
  it('sets fps through the command layer and restores it on undo', () => {
    const editor = createEditor()

    expect(editor.commands.setFps(29.97)).toEqual({ success: true })
    expect(editor.state.videoBasicInfo.fps).toBe(29.97)

    editor.commands.undo()
    expect(editor.state.videoBasicInfo.fps).toBe(30)
  })

  it('rejects an invalid frame rate', () => {
    const editor = createEditor()

    expect(editor.commands.setFps(0).success).toBe(false)
    expect(editor.state.videoBasicInfo.fps).toBe(30)
  })
})

describe('selectors', () => {
  it('finds segments and tracks', () => {
    const editor = createEditor()
    const id = editor.commands.addSegment({ ...framesSegment }).id
    const track = editor.selectors.getTrackBySegmentId(id)

    expect(track).toBeDefined()
    expect(editor.selectors.getTrackById(track!.trackId)?.trackId).toBe(track!.trackId)
    expect(editor.selectors.getSegment(id)?.id).toBe(id)
  })

  it('filters tracks by type', () => {
    const editor = createEditor()
    editor.commands.addSegment({ ...framesSegment })
    addOverlaySegments(editor, [0])

    expect(editor.selectors.getTracks()).toHaveLength(2)
    expect(editor.selectors.getTracks('frames')).toHaveLength(1)
    expect(editor.selectors.getTracks('text')).toHaveLength(1)
  })

  it('returns undefined for unknown ids', () => {
    const editor = createEditor()

    expect(editor.selectors.getSegment('nope')).toBeUndefined()
    expect(editor.selectors.getTrackById('nope')).toBeUndefined()
    expect(editor.selectors.getTrackBySegmentId('nope')).toBeUndefined()
  })
})

describe('transactions', () => {
  it('collapses a batch of commands into one undo step', () => {
    const editor = createEditor()
    const [a, b] = addOverlaySegments(editor, [0, 4000])
    const undoBefore = editor.state.undoCount.value
    const aStart = editor.state.segmentMap.value[a]!.startTime
    const bStart = editor.state.segmentMap.value[b]!.startTime

    const result = editor.commands.transaction(() => {
      for (const id of [a, b]) {
        editor.commands.updateSegment((segment) => {
          segment.startTime += 500
          segment.endTime += 500
        }, id)
      }
      return 'moved'
    }, { label: 'move-segments' })

    expect(result.status).toBe('committed')
    expect(result.value).toBe('moved')
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(editor.state.segmentMap.value[a]?.startTime).toBe(aStart)
    expect(editor.state.segmentMap.value[b]?.startTime).toBe(bStart)
  })

  it('rolls back the whole batch when one command throws', () => {
    const editor = createEditor()
    const [a] = addOverlaySegments(editor, [0])
    const undoBefore = editor.state.undoCount.value
    const snapshot = structuredClone(editor.commands.exportProtocol())

    expect(() => editor.commands.transaction(() => {
      editor.commands.updateSegment((segment) => {
        segment.startTime += 500
        segment.endTime += 500
      }, a)
      throw new Error('command failed')
    })).toThrow('command failed')

    expect(editor.commands.exportProtocol()).toEqual(snapshot)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('discards a cancelled batch without touching history', () => {
    const editor = createEditor()
    const [a] = addOverlaySegments(editor, [0])
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.transaction((tx) => {
      editor.commands.removeSegment(a)
      tx.cancel()
    })

    expect(result.status).toBe('cancelled')
    expect(editor.state.segmentMap.value[a]).toBeDefined()
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('collapses a continuous drag opened with beginTransaction', () => {
    const editor = createEditor()
    const [a] = addOverlaySegments(editor, [0])
    const undoBefore = editor.state.undoCount.value

    const tx = editor.commands.beginTransaction({ label: 'drag-segment' })
    expect(editor.state.isTransactionActive.value).toBe(true)

    for (const startTime of [100, 200, 300]) {
      editor.commands.updateSegment((segment) => {
        segment.startTime = startTime
        segment.endTime = startTime + 1000
      }, a)
      expect(editor.state.segmentMap.value[a]?.startTime).toBe(startTime)
      expect(editor.state.undoCount.value).toBe(undoBefore)
    }

    expect(tx.commit()).toBe('committed')
    expect(editor.state.isTransactionActive.value).toBe(false)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()
    expect(editor.state.segmentMap.value[a]?.startTime).toBe(0)
  })

  it('does not record a batch that changed nothing', () => {
    const editor = createEditor()
    addOverlaySegments(editor, [0])
    const undoBefore = editor.state.undoCount.value

    expect(editor.commands.transaction(() => {}).status).toBe('empty')
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })
})

describe('protocol export', () => {
  it('exports a snapshot that reflects committed edits', () => {
    const editor = createEditor()
    editor.commands.addSegment({ ...framesSegment })
    editor.commands.setCanvasSize({ width: 1080, height: 1920 })

    const exported = editor.commands.exportProtocol()

    expect(exported.width).toBe(1080)
    expect(exported.height).toBe(1920)
    expect(exported.tracks[0].children).toHaveLength(1)
  })
})
