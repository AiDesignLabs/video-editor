import type { ITextSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { createVideoProtocolManager, MAX_CANVAS_SIZE, MIN_CANVAS_SIZE } from './index'

const protocol: IVideoProtocol = {
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

function createManager() {
  return createVideoProtocolManager(structuredClone(protocol))
}

const textSegment: ITextSegment = {
  id: '',
  segmentType: 'text',
  startTime: 0,
  endTime: 1000,
  texts: [{ content: 'hello' }],
}

/**
 * Seeds overlay text segments at the given start times, outside any
 * transaction. Overlay tracks allow gaps, so these edits stay independent of
 * the main track's rebuild rules.
 */
function seedOverlaySegments(manager: ReturnType<typeof createManager>, times: number[]) {
  return times.map((startTime) => {
    manager.curTime.value = startTime
    return manager.addSegment({ ...textSegment, startTime, endTime: startTime + 1000 }).id
  })
}

function startTimeOf(manager: ReturnType<typeof createManager>, id: string) {
  const startTime = manager.segmentMap.value[id]?.startTime
  if (startTime === undefined)
    throw new Error(`segment ${id} not found`)
  return startTime
}

describe('protocol transactions', () => {
  it('groups track structure commands into one undo step', () => {
    const manager = createManager()
    const undoBefore = manager.undoCount.value

    manager.transaction(() => {
      manager.addTrack({ trackType: 'text', trackId: 'titles' })
      manager.addTrack({ trackType: 'audio', trackId: 'audio', index: 1 })
      manager.moveTrack('audio', 0)
    }, { label: 'arrange-tracks' })

    expect(manager.protocol.value.tracks.map(track => track.trackId)).toEqual(['audio', 'titles'])
    expect(manager.undoCount.value).toBe(undoBefore + 1)

    manager.undo()
    expect(manager.protocol.value.tracks).toEqual([])
    expect(manager.undoCount.value).toBe(undoBefore)
  })

  it('collapses a batch move into a single undo step', () => {
    const manager = createManager()
    const [a, b] = seedOverlaySegments(manager, [0, 4000])
    const before = manager.undoCount.value
    const aStart = startTimeOf(manager, a)
    const bStart = startTimeOf(manager, b)

    manager.transaction(() => {
      manager.updateSegment((segment) => {
        segment.startTime += 500
        segment.endTime += 500
      }, a)
      manager.updateSegment((segment) => {
        segment.startTime += 500
        segment.endTime += 500
      }, b)
    }, { label: 'move-segments' })

    expect(manager.undoCount.value).toBe(before + 1)
    expect(manager.segmentMap.value[a]?.startTime).toBe(aStart + 500)
    expect(manager.segmentMap.value[b]?.startTime).toBe(bStart + 500)

    manager.undo()

    expect(manager.segmentMap.value[a]?.startTime).toBe(aStart)
    expect(manager.segmentMap.value[b]?.startTime).toBe(bStart)
    expect(manager.undoCount.value).toBe(before)
  })

  it('restores every segment on redo', () => {
    const manager = createManager()
    const [a, b] = seedOverlaySegments(manager, [0, 4000])

    const aEnd = startTimeOf(manager, a) + 800
    const bEnd = startTimeOf(manager, b) + 800

    manager.transaction(() => {
      manager.updateSegment((segment) => {
        segment.endTime = aEnd
      }, a)
      manager.updateSegment((segment) => {
        segment.endTime = bEnd
      }, b)
    })

    manager.undo()
    manager.redo()

    expect(manager.segmentMap.value[a]?.endTime).toBe(aEnd)
    expect(manager.segmentMap.value[b]?.endTime).toBe(bEnd)
  })

  it('leaves the protocol and both stacks untouched when a batch fails midway', () => {
    const manager = createManager()
    const [a, b] = seedOverlaySegments(manager, [0, 4000])
    const snapshot = structuredClone(manager.exportProtocol())
    const undoBefore = manager.undoCount.value

    manager.undo()
    manager.redo()
    const redoBefore = manager.redoCount.value

    expect(() => manager.transaction(() => {
      manager.updateSegment((segment) => {
        segment.startTime += 500
        segment.endTime += 500
      }, a)
      manager.updateSegment((segment) => {
        segment.endTime = 9999
      }, b)
      throw new Error('batch failed')
    })).toThrow('batch failed')

    expect(manager.exportProtocol()).toEqual(snapshot)
    expect(manager.undoCount.value).toBe(undoBefore)
    expect(manager.redoCount.value).toBe(redoBefore)
  })

  it('discards a cancelled transaction without touching history', () => {
    const manager = createManager()
    const [a] = seedOverlaySegments(manager, [0])
    const undoBefore = manager.undoCount.value

    const result = manager.transaction((tx) => {
      manager.removeSegment(a)
      tx.cancel()
    })

    expect(result.status).toBe('cancelled')
    expect(manager.segmentMap.value[a]).toBeDefined()
    expect(manager.undoCount.value).toBe(undoBefore)
  })

  it('does not record an empty transaction', () => {
    const manager = createManager()
    seedOverlaySegments(manager, [0])
    const undoBefore = manager.undoCount.value

    const result = manager.transaction(() => {})

    expect(result.status).toBe('empty')
    expect(manager.undoCount.value).toBe(undoBefore)
  })

  it('undoes a mixed add, update and remove batch as one step', () => {
    const manager = createManager()
    const [existing] = seedOverlaySegments(manager, [0])
    const snapshot = structuredClone(manager.exportProtocol())
    const undoBefore = manager.undoCount.value

    let addedId = ''
    manager.transaction(() => {
      manager.curTime.value = 5000
      addedId = manager.addSegment({ ...framesSegment, startTime: 5000, endTime: 6000 }).id
      manager.updateSegment((segment) => {
        segment.endTime = startTimeOf(manager, existing) + 900
      }, existing)
      manager.removeSegment(addedId)
    }, { label: 'mixed-batch' })

    expect(manager.undoCount.value).toBe(undoBefore + 1)
    expect(manager.segmentMap.value[addedId]).toBeUndefined()
    expect(manager.segmentMap.value[existing]?.endTime).toBe(900)

    manager.undo()

    expect(manager.exportProtocol()).toEqual(snapshot)
  })

  it('reuses the outermost transaction when nested', () => {
    const manager = createManager()
    const [a, b] = seedOverlaySegments(manager, [0, 4000])
    const undoBefore = manager.undoCount.value

    const aEnd = manager.segmentMap.value[a]?.endTime
    const bEnd = manager.segmentMap.value[b]?.endTime

    manager.transaction(() => {
      manager.updateSegment((segment) => {
        segment.endTime = startTimeOf(manager, a) + 900
      }, a)

      const inner = manager.transaction(() => {
        manager.updateSegment((segment) => {
          segment.endTime = startTimeOf(manager, b) + 900
        }, b)
      })

      expect(inner.status).toBe('nested')
      expect(manager.undoCount.value).toBe(undoBefore)
    })

    expect(manager.undoCount.value).toBe(undoBefore + 1)

    manager.undo()

    expect(manager.segmentMap.value[a]?.endTime).toBe(aEnd)
    expect(manager.segmentMap.value[b]?.endTime).toBe(bEnd)
  })

  it('collapses a continuous drag into one history item', () => {
    const manager = createManager()
    const [a] = seedOverlaySegments(manager, [0])
    const undoBefore = manager.undoCount.value

    // pointer down
    const tx = manager.beginTransaction({ label: 'drag-segment', data: { segmentId: a } })

    // pointer move: the preview must stay live during the drag
    for (const startTime of [100, 200, 300]) {
      manager.updateSegment((segment) => {
        segment.startTime = startTime
        segment.endTime = startTime + 1000
      }, a)
      expect(manager.segmentMap.value[a]?.startTime).toBe(startTime)
      expect(manager.undoCount.value).toBe(undoBefore)
    }

    // pointer up
    expect(tx.commit()).toBe('committed')
    expect(manager.undoCount.value).toBe(undoBefore + 1)

    manager.undo()
    expect(manager.segmentMap.value[a]?.startTime).toBe(0)
  })

  it('restores the pre-drag state when the drag is cancelled', () => {
    const manager = createManager()
    const [a] = seedOverlaySegments(manager, [0])
    const undoBefore = manager.undoCount.value

    const tx = manager.beginTransaction()
    manager.updateSegment((segment) => {
      segment.startTime = 400
      segment.endTime = 1400
    }, a)
    tx.cancel()

    expect(manager.segmentMap.value[a]?.startTime).toBe(0)
    expect(manager.segmentMap.value[a]?.endTime).toBe(1000)
    expect(manager.undoCount.value).toBe(undoBefore)
  })

  it('refuses undo and redo while a transaction is open', () => {
    const manager = createManager()
    const [a] = seedOverlaySegments(manager, [0])

    const tx = manager.beginTransaction()
    manager.updateSegment((segment) => {
      segment.endTime = 500
    }, a)

    expect(manager.undo().success).toBe(false)
    expect(manager.redo().success).toBe(false)
    expect(manager.segmentMap.value[a]?.endTime).toBe(500)

    tx.commit()
    expect(manager.undo().success).toBe(true)
    expect(manager.segmentMap.value[a]?.endTime).toBe(1000)
  })

  it('reports whether a transaction is open', () => {
    const manager = createManager()

    expect(manager.isTransactionActive.value).toBe(false)
    manager.transaction(() => {
      expect(manager.isTransactionActive.value).toBe(true)
      expect(manager.transactionDepth.value).toBe(1)
    })
    expect(manager.isTransactionActive.value).toBe(false)
  })
})

describe('updateSegment rollback', () => {
  it('does not consume an unrelated history item when an edit is rejected', () => {
    const manager = createManager()
    const a = manager.addSegment({ ...framesSegment }).id
    const undoBefore = manager.undoCount.value

    manager.updateSegment((segment) => {
      segment.url = 'invalid url'
    }, a)

    expect(manager.segmentMap.value[a]?.url).toBe(framesSegment.url)
    expect(manager.undoCount.value).toBe(undoBefore)

    // The segment that existed before the rejected edit is still undoable.
    manager.undo()
    expect(manager.segmentMap.value[a]).toBeUndefined()
  })

  it('undoes an endTime edit together with the ripple it caused', () => {
    const manager = createManager()
    const first = manager.addSegment({ ...framesSegment }).id
    manager.curTime.value = 1000
    const second = manager.addSegment({ ...framesSegment }).id

    expect(manager.segmentMap.value[second]?.startTime).toBe(1000)

    manager.updateSegment((segment) => {
      segment.endTime = 2000
    }, first)

    expect(manager.segmentMap.value[second]?.startTime).toBe(2000)
    expect(manager.segmentMap.value[second]?.endTime).toBe(3000)

    manager.undo()

    expect(manager.segmentMap.value[first]?.endTime).toBe(1000)
    expect(manager.segmentMap.value[second]?.startTime).toBe(1000)
    expect(manager.segmentMap.value[second]?.endTime).toBe(2000)
  })
})

describe('canvas constraints', () => {
  it('rejects a protocol whose canvas the encoder cannot use', () => {
    // Constructing a manager runs the protocol through the schema, so bypassing
    // `setCanvasSize` is not a way to smuggle in an illegal canvas.
    for (const size of [{ width: 0 }, { height: 0 }, { width: 1 }, { width: 1920.5 }, { width: 99999 }])
      expect(() => createVideoProtocolManager({ ...protocol, ...size })).toThrow()
  })

  it('accepts the bounds the command accepts', () => {
    expect(() => createVideoProtocolManager({ ...protocol, width: MIN_CANVAS_SIZE, height: MIN_CANVAS_SIZE })).not.toThrow()
    expect(() => createVideoProtocolManager({ ...protocol, width: MAX_CANVAS_SIZE, height: MAX_CANVAS_SIZE })).not.toThrow()
  })

  it('reports the same bounds through setCanvasSize', () => {
    const manager = createManager()

    expect(manager.setCanvasSize({ width: MIN_CANVAS_SIZE - 1, height: 1080 }).success).toBe(false)
    expect(manager.setCanvasSize({ width: MAX_CANVAS_SIZE + 1, height: 1080 }).success).toBe(false)
    expect(manager.setCanvasSize({ width: MIN_CANVAS_SIZE, height: MIN_CANVAS_SIZE }).success).toBe(true)
  })
})

describe('moveSegment target resolution', () => {
  it('keeps the segment on its own track when no target is given', () => {
    const manager = createManager()
    const [a] = seedOverlaySegments(manager, [0])
    const trackId = manager.protocol.value.tracks.find(track => track.children.some(s => s.id === a))?.trackId

    expect(trackId).toBeDefined()

    // An omitted `targetTrackId` used to remove the segment from its track and
    // never re-add it, while still reporting success.
    const result = manager.moveSegment({
      segmentId: a,
      sourceTrackId: trackId!,
      startTime: 1000,
      endTime: 1500,
    })

    expect(result.success).toBe(true)
    expect(manager.segmentMap.value[a]).toBeDefined()
    expect(manager.segmentMap.value[a]?.startTime).toBe(1000)
    expect(manager.segmentMap.value[a]?.endTime).toBe(1500)
  })

  it('refuses to create a track without an insert position', () => {
    const manager = createManager()
    const [a] = seedOverlaySegments(manager, [0])
    const trackId = manager.protocol.value.tracks.find(track => track.children.some(s => s.id === a))?.trackId

    const result = manager.moveSegment({
      segmentId: a,
      sourceTrackId: trackId!,
      startTime: 1000,
      endTime: 1500,
      isNewTrack: true,
    })

    expect(result.success).toBe(false)
    expect(manager.segmentMap.value[a]?.startTime).toBe(0)
  })
})

describe('refused commands and history', () => {
  it('leaves history untouched when a command refuses', () => {
    const manager = createManager()
    seedOverlaySegments(manager, [0])
    const undoBefore = manager.undoCount.value
    const snapshot = structuredClone(manager.exportProtocol())

    // The transition sync runs even when the updater bails out, and its write
    // to `protocol.transitions` used to be enough to record a history item for
    // a command that changed nothing.
    expect(manager.updateTrack('missing', (track) => {
      track.hidden = true
    })).toBe(false)
    expect(manager.removeSegment('missing').success).toBe(false)
    expect(manager.replaceTrackId('missing', 'other')).toBe(false)
    expect(manager.addTransition({ id: 'fade', name: 'fade', duration: 300 }, 0)).toBe(false)

    expect(manager.undoCount.value).toBe(undoBefore)
    expect(manager.exportProtocol()).toEqual(snapshot)
  })

  it('does not clear the redo stack when a command refuses', () => {
    const manager = createManager()
    const [a] = seedOverlaySegments(manager, [0])
    manager.updateSegment((segment) => {
      segment.endTime = 800
    }, a)
    manager.undo()
    const redoBefore = manager.redoCount.value

    expect(manager.updateTrack('missing', (track) => {
      track.hidden = true
    })).toBe(false)

    expect(manager.redoCount.value).toBe(redoBefore)
  })
})
