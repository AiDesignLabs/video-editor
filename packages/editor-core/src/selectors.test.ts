import type { IAudioSegment, ITextSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
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

const audioSegment: IAudioSegment = {
  id: '',
  segmentType: 'audio',
  startTime: 0,
  endTime: 1000,
  fromTime: 0,
  url: 'http://example.com/audio.mp3',
}

function createEditor() {
  return createEditorCore({ protocol: structuredClone(baseProtocol) })
}

/** Main frames track: no gaps, segments appended back to back. */
function seedMainTrack(editor: ReturnType<typeof createEditor>, count: number) {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    editor.commands.setCurrentTime(i * 1000)
    ids.push(editor.commands.addSegment({ ...framesSegment }).id)
  }
  return ids
}

function trackOf(editor: ReturnType<typeof createEditor>, segmentId: string) {
  const trackId = editor.selectors.getTrackBySegmentId(segmentId)?.trackId
  if (!trackId)
    throw new Error(`segment ${segmentId} is on no track`)
  return trackId
}

describe('time queries', () => {
  it('answers what is on screen at a moment', () => {
    const editor = createEditor()
    const [first, second] = seedMainTrack(editor, 2)
    editor.commands.setCurrentTime(500)
    const caption = editor.commands.addSegment({ ...textSegment, startTime: 500, endTime: 1500 }).id

    const at700 = editor.selectors.getSegmentsAt(700)

    expect(at700.map(item => item.segment.id).sort()).toEqual([caption, first].sort())
    expect(at700.map(item => item.trackType).sort()).toEqual(['frames', 'text'])
    expect(editor.selectors.getSegmentsAt(1200).map(item => item.segment.id).sort())
      .toEqual([caption, second].sort())
  })

  it('treats a segment range as half-open so a boundary belongs to one segment', () => {
    const editor = createEditor()
    const [first, second] = seedMainTrack(editor, 2)

    const atBoundary = editor.selectors.getSegmentsAt(1000)

    expect(atBoundary).toHaveLength(1)
    expect(atBoundary[0].segment.id).toBe(second)
    expect(editor.selectors.getSegmentsAt(999)[0].segment.id).toBe(first)
  })

  it('returns nothing past the end of the timeline', () => {
    const editor = createEditor()
    seedMainTrack(editor, 1)

    expect(editor.selectors.getSegmentsAt(5000)).toEqual([])
  })

  it('filters by track type', () => {
    const editor = createEditor()
    seedMainTrack(editor, 1)
    editor.commands.setCurrentTime(0)
    const caption = editor.commands.addSegment({ ...textSegment }).id

    const text = editor.selectors.getSegmentsAt(500, { trackType: 'text' })

    expect(text).toHaveLength(1)
    expect(text[0].segment.id).toBe(caption)
  })

  it('can skip hidden tracks, which is what actually reaches the screen', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    const trackId = trackOf(editor, id)

    expect(editor.selectors.getSegmentsAt(500, { includeHidden: false })).toHaveLength(1)

    editor.commands.updateTrack(trackId, (track) => {
      track.hidden = true
    })

    expect(editor.selectors.getSegmentsAt(500, { includeHidden: false })).toHaveLength(0)
    // Without the flag a hidden track is still part of the project.
    expect(editor.selectors.getSegmentsAt(500)).toHaveLength(1)
  })

  it('finds the segment playing on one track', () => {
    const editor = createEditor()
    const [first, second] = seedMainTrack(editor, 2)
    const trackId = trackOf(editor, first)

    expect(editor.selectors.getSegmentAt(trackId, 200)?.id).toBe(first)
    expect(editor.selectors.getSegmentAt(trackId, 1200)?.id).toBe(second)
    expect(editor.selectors.getSegmentAt(trackId, 9000)).toBeUndefined()
    expect(editor.selectors.getSegmentAt('missing', 0)).toBeUndefined()
  })
})

describe('structure queries', () => {
  it('reports the gaps on an overlay track', () => {
    const editor = createEditor()
    editor.commands.setCurrentTime(1000)
    const first = editor.commands.addSegment({ ...textSegment, startTime: 1000, endTime: 1500 }).id
    editor.commands.setCurrentTime(3000)
    editor.commands.addSegment({ ...textSegment, startTime: 3000, endTime: 3500 })
    const trackId = trackOf(editor, first)

    expect(editor.selectors.getTrackGaps(trackId)).toEqual([
      { startTime: 0, endTime: 1000 },
      { startTime: 1500, endTime: 3000 },
    ])
  })

  it('reports no gaps on the main frames track, which forbids them', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 3)

    expect(editor.selectors.getTrackGaps(trackOf(editor, id))).toEqual([])
  })

  it('returns nothing for an unknown track', () => {
    const editor = createEditor()

    expect(editor.selectors.getTrackGaps('missing')).toEqual([])
  })

  it('finds the segments either side of one', () => {
    const editor = createEditor()
    const [first, second, third] = seedMainTrack(editor, 3)

    const middle = editor.selectors.getAdjacentSegments(second)
    expect(middle.previous?.id).toBe(first)
    expect(middle.next?.id).toBe(third)
    expect(middle.trackId).toBe(trackOf(editor, second))

    expect(editor.selectors.getAdjacentSegments(first).previous).toBeUndefined()
    expect(editor.selectors.getAdjacentSegments(third).next).toBeUndefined()
    expect(editor.selectors.getAdjacentSegments('missing')).toEqual({})
  })

  it('finds no overlaps in a project the commands built', () => {
    const editor = createEditor()
    seedMainTrack(editor, 3)
    editor.commands.setCurrentTime(0)
    editor.commands.addSegment({ ...textSegment })

    expect(editor.selectors.getOverlaps()).toEqual([])
  })

  it('reports an overlap smuggled in through the loaded protocol', () => {
    // The commands refuse to create one, but a project loaded from elsewhere
    // can still carry it, and an agent needs to be able to see it.
    const editor = createEditorCore({
      protocol: {
        ...structuredClone(baseProtocol),
        tracks: [{
          trackId: 'overlay',
          trackType: 'text',
          children: [
            { ...textSegment, id: 'a', startTime: 0, endTime: 1000 },
            { ...textSegment, id: 'b', startTime: 500, endTime: 1500 },
          ],
        }],
      },
    })

    const overlaps = editor.selectors.getOverlaps()

    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].a.id).toBe('a')
    expect(overlaps[0].b.id).toBe('b')
    expect(overlaps[0].startTime).toBe(500)
    expect(overlaps[0].endTime).toBe(1000)
    expect(editor.selectors.getOverlaps('overlay')).toHaveLength(1)
    expect(editor.selectors.getOverlaps('missing')).toEqual([])
  })
})

describe('property sampling', () => {
  it('reports the documented default when nothing sets the property', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)

    expect(editor.selectors.sampleProperty(id, 'opacity', 500)).toEqual({
      value: 1,
      source: 'default',
      withinSegment: true,
    })
    expect(editor.selectors.sampleProperty(id, 'rotation', 500)?.value).toBe(0)
  })

  it('reports a static value set on the segment', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    editor.commands.updateSegment((segment) => {
      if (segment.segmentType === 'frames')
        segment.opacity = 0.4
    }, id)

    expect(editor.selectors.sampleProperty(id, 'opacity', 500)).toEqual({
      value: 0.4,
      source: 'static',
      withinSegment: true,
    })
  })

  it('reads a static transform value off the right axis', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    editor.commands.updateSegment((segment) => {
      if (segment.segmentType === 'frames') {
        segment.transform = {
          position: [0.25, -0.5, 0],
          rotation: [0, 0, 90],
          scale: [2, 2, 1],
        }
      }
    }, id)

    expect(editor.selectors.sampleProperty(id, 'position.x', 0)?.value).toBe(0.25)
    expect(editor.selectors.sampleProperty(id, 'position.y', 0)?.value).toBe(-0.5)
    expect(editor.selectors.sampleProperty(id, 'rotation', 0)?.value).toBe(90)
    expect(editor.selectors.sampleProperty(id, 'scale', 0)?.value).toBe(2)
  })

  it('distinguishes a value sitting on a keyframe from one between two', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    editor.commands.updateSegment((segment) => {
      segment.keyframes = [{
        property: 'opacity',
        frames: [
          { timeMs: 0, value: 0 },
          { timeMs: 1000, value: 1 },
        ],
      }]
    }, id)

    expect(editor.selectors.sampleProperty(id, 'opacity', 0)).toEqual({
      value: 0,
      source: 'keyframe',
      withinSegment: true,
    })
    expect(editor.selectors.sampleProperty(id, 'opacity', 500)).toEqual({
      value: 0.5,
      source: 'interpolated',
      withinSegment: true,
    })
  })

  it('samples keyframe time relative to the segment, not the timeline', () => {
    const editor = createEditor()
    const [, second] = seedMainTrack(editor, 2)
    editor.commands.updateSegment((segment) => {
      segment.keyframes = [{
        property: 'opacity',
        frames: [
          { timeMs: 0, value: 0 },
          { timeMs: 1000, value: 1 },
        ],
      }]
    }, second)

    // The segment runs 1000–2000, so timeline 1500 is 500 into its own curve.
    expect(editor.selectors.sampleProperty(second, 'opacity', 1500)?.value).toBe(0.5)
  })

  it('flags a time that falls outside the segment but still reports the held value', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 2)
    editor.commands.updateSegment((segment) => {
      segment.keyframes = [{
        property: 'opacity',
        frames: [
          { timeMs: 0, value: 0 },
          { timeMs: 1000, value: 1 },
        ],
      }]
    }, id)

    const sampled = editor.selectors.sampleProperty(id, 'opacity', 5000)

    expect(sampled?.withinSegment).toBe(false)
    // Values hold past the last keyframe rather than vanishing.
    expect(sampled?.value).toBe(1)
    expect(sampled?.source).toBe('keyframe')
  })

  it('prefers a keyframe curve over the static value', () => {
    const editor = createEditor()
    editor.commands.setCurrentTime(0)
    const id = editor.commands.addSegment({ ...audioSegment }).id
    editor.commands.updateSegment((segment) => {
      if (segment.segmentType === 'audio') {
        segment.volume = 0.2
        segment.keyframes = [{ property: 'volume', frames: [{ timeMs: 0, value: 0.9 }] }]
      }
    }, id)

    // A lone keyframe holds its value; that is read off a frame, not interpolated.
    expect(editor.selectors.sampleProperty(id, 'volume', 100)).toMatchObject({
      value: 0.9,
      source: 'keyframe',
    })
  })

  it('returns undefined for an unknown segment', () => {
    const editor = createEditor()

    expect(editor.selectors.sampleProperty('missing', 'opacity', 0)).toBeUndefined()
  })
})

describe('selection queries', () => {
  it('resolves the current selection against the protocol', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)

    expect(editor.selectors.getSelection()).toEqual({})

    editor.commands.setSelectedSegment(id)
    const selection = editor.selectors.getSelection()

    expect(selection.segmentId).toBe(id)
    expect(selection.segment?.id).toBe(id)
    expect(selection.trackId).toBe(trackOf(editor, id))
  })

  it('reports no selection once the selected segment is gone', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    editor.commands.setSelectedSegment(id)
    editor.commands.removeSegment(id)

    expect(editor.selectors.getSelection()).toEqual({})
  })
})

describe('canRun', () => {
  it('gates undo and redo on the history stacks', () => {
    const editor = createEditor()

    expect(editor.selectors.canRun({ command: 'undo' })).toEqual({ ok: false, reason: 'nothing to undo' })

    seedMainTrack(editor, 1)

    expect(editor.selectors.canRun({ command: 'undo' }).ok).toBe(true)
    expect(editor.selectors.canRun({ command: 'redo' }).ok).toBe(false)

    editor.commands.undo()

    expect(editor.selectors.canRun({ command: 'redo' }).ok).toBe(true)
  })

  it('refuses a split outside the segment and allows one inside it', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)

    expect(editor.selectors.canRun({ command: 'splitSegment', segmentId: id, timelineMs: 500 }).ok).toBe(true)

    for (const timelineMs of [0, 1000, -1, 5000, Number.NaN]) {
      const check = editor.selectors.canRun({ command: 'splitSegment', segmentId: id, timelineMs })
      expect(check.ok).toBe(false)
      expect(check.reason).toBeTruthy()
    }
  })

  it('agrees with what the command actually does', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)

    // A check that says yes must not be followed by a refusal, and vice versa.
    for (const timelineMs of [0, 250, 1000]) {
      const predicted = editor.selectors.canRun({ command: 'splitSegment', segmentId: id, timelineMs }).ok
      const editorForRun = createEditor()
      const [runId] = seedMainTrack(editorForRun, 1)
      expect(editorForRun.commands.splitSegment(runId, timelineMs).success).toBe(predicted)
    }
  })

  it('gates segment commands on the segment existing', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)

    expect(editor.selectors.canRun({ command: 'removeSegment', segmentId: id }).ok).toBe(true)
    expect(editor.selectors.canRun({ command: 'duplicateSegment', segmentId: 'missing' }))
      .toEqual({ ok: false, reason: 'no segment with id missing' })
  })

  it('gates a transition on there being two adjacent segments', () => {
    const editor = createEditor()

    expect(editor.selectors.canRun({ command: 'addTransition' }))
      .toEqual({ ok: false, reason: 'the project has no main frames track' })

    const single = createEditor()
    seedMainTrack(single, 1)
    expect(single.selectors.canRun({ command: 'addTransition' }).reason)
      .toContain('two adjacent segments')

    const pair = createEditor()
    seedMainTrack(pair, 2)
    expect(pair.selectors.canRun({ command: 'addTransition' }).ok).toBe(true)
    expect(pair.commands.addTransition({ id: 'fade', name: 'fade', duration: 300 }, 1000)).toBe(true)
  })

  it('gates a canvas resize on the same bounds the command enforces', () => {
    const editor = createEditor()

    expect(editor.selectors.canRun({ command: 'setCanvasSize', width: 1080, height: 1920 }).ok).toBe(true)

    for (const size of [{ width: 0, height: 1080 }, { width: 1920.5, height: 1080 }, { width: 99999, height: 1080 }]) {
      const check = editor.selectors.canRun({ command: 'setCanvasSize', ...size })
      expect(check.ok).toBe(false)
      // The check and the command must never disagree.
      expect(editor.commands.setCanvasSize(size).success).toBe(false)
    }
  })
})
