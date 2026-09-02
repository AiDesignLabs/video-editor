import type { ITransition, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import type { EditorCorePlugin, SegmentPlugin } from './types'
import { describe, expect, it, vi } from 'vitest'
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

const transition: ITransition = {
  id: 'fade',
  name: '淡入淡出',
  duration: 300,
}

function createEditor() {
  return createEditorCore({ protocol: structuredClone(baseProtocol) })
}

/** Transitions only exist between adjacent segments of the main frames track. */
function seedMainTrack(editor: ReturnType<typeof createEditor>, count: number) {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    editor.commands.setCurrentTime(i * 1000)
    ids.push(editor.commands.addSegment({ ...framesSegment }).id)
  }
  return ids
}

describe('transition commands', () => {
  it('adds a transition between two adjacent main track segments', () => {
    const editor = createEditor()
    seedMainTrack(editor, 2)
    const undoBefore = editor.state.undoCount.value

    expect(editor.commands.addTransition(transition, 1000)).toBe(true)

    const edges = editor.state.protocol.value.transitions ?? []
    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe('fade')
    expect(edges[0].duration).toBe(300)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)
  })

  it('refuses a transition when there is nothing to sit between', () => {
    const editor = createEditor()
    seedMainTrack(editor, 1)
    const undoBefore = editor.state.undoCount.value

    expect(editor.commands.addTransition(transition, 0)).toBe(false)
    expect(editor.state.protocol.value.transitions ?? []).toHaveLength(0)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('updates a transition in place', () => {
    const editor = createEditor()
    const [first] = seedMainTrack(editor, 2)
    editor.commands.addTransition(transition, 1000)

    expect(editor.commands.updateTransition(first, (edge) => {
      edge.duration = 500
    })).toBe(true)

    expect(editor.state.protocol.value.transitions?.[0].duration).toBe(500)
  })

  it('removes a transition and restores it on undo', () => {
    const editor = createEditor()
    const [first] = seedMainTrack(editor, 2)
    editor.commands.addTransition(transition, 1000)

    expect(editor.commands.removeTransition(first)).toBe(true)
    expect(editor.state.protocol.value.transitions ?? []).toHaveLength(0)

    editor.commands.undo()

    expect(editor.state.protocol.value.transitions ?? []).toHaveLength(1)
  })

  it('reports failure for a segment that is not on the main track', () => {
    const editor = createEditor()
    seedMainTrack(editor, 2)

    expect(editor.commands.removeTransition('missing')).toBe(false)
    expect(editor.commands.updateTransition('missing', (edge) => {
      edge.duration = 100
    })).toBe(false)
  })
})

describe('updateTrack', () => {
  it('toggles the presentation fields and records one undo step', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    const trackId = editor.selectors.getTrackBySegmentId(id)!.trackId
    const undoBefore = editor.state.undoCount.value

    expect(editor.commands.updateTrack(trackId, (track) => {
      track.hidden = true
      track.muted = true
    })).toBe(true)

    const track = editor.selectors.getTrackById(trackId)
    expect(track?.hidden).toBe(true)
    expect(track?.muted).toBe(true)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(editor.selectors.getTrackById(trackId)?.hidden).toBeUndefined()
  })

  it('reports failure for an unknown track', () => {
    const editor = createEditor()
    const undoBefore = editor.state.undoCount.value

    expect(editor.commands.updateTrack('missing', (track) => {
      track.hidden = true
    })).toBe(false)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })
})

describe('track structure commands', () => {
  it('adds, reorders, and removes tracks through editor-core', () => {
    const editor = createEditor()

    expect(editor.commands.addTrack({ trackType: 'text', trackId: 'titles' }))
      .toEqual({ success: true, trackId: 'titles' })
    expect(editor.commands.addTrack({ trackType: 'audio', trackId: 'audio', index: 1 }).success).toBe(true)
    expect(editor.commands.moveTrack('audio', 0)).toEqual({ success: true })
    expect(editor.selectors.getTracks().map(track => track.trackId)).toEqual(['audio', 'titles'])

    expect(editor.commands.removeTrack('titles')).toEqual({ success: true, removedSegmentIds: [] })
    expect(editor.selectors.getTrackById('titles')).toBeUndefined()

    editor.commands.undo()
    expect(editor.selectors.getTrackById('titles')).toBeDefined()
  })
})

describe('duplicateSegment', () => {
  it('places a copy and reports its new id', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    const undoBefore = editor.state.undoCount.value

    const result = editor.commands.duplicateSegment(id)

    expect(result.success).toBe(true)
    expect(result.id).not.toBe(id)
    expect(editor.selectors.getSegment(result.id)?.url).toBe(framesSegment.url)
    expect(editor.state.undoCount.value).toBe(undoBefore + 1)

    editor.commands.undo()

    expect(editor.selectors.getSegment(result.id)).toBeUndefined()
  })

  it('reports failure for an unknown segment', () => {
    const editor = createEditor()

    expect(editor.commands.duplicateSegment('missing').success).toBe(false)
  })
})

describe('id replacement', () => {
  it('replaces a track id', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    const trackId = editor.selectors.getTrackBySegmentId(id)!.trackId

    expect(editor.commands.replaceTrackId(trackId, 'renamed-track')).toBe(true)
    expect(editor.selectors.getTrackById('renamed-track')).toBeDefined()
    expect(editor.selectors.getTrackById(trackId)).toBeUndefined()
  })

  it('replaces a segment id', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)

    expect(editor.commands.replaceSegmentId(id, 'renamed-segment')).toBe(true)
    expect(editor.selectors.getSegment('renamed-segment')).toBeDefined()
    expect(editor.selectors.getSegment(id)).toBeUndefined()
  })

  it('refuses to collide with an id already in use', () => {
    const editor = createEditor()
    const [first, second] = seedMainTrack(editor, 2)

    expect(editor.commands.replaceSegmentId(first, second)).toBe(false)
    expect(editor.selectors.getSegment(first)).toBeDefined()
  })

  it('treats replacing an id with itself as a no-op', () => {
    const editor = createEditor()
    const [id] = seedMainTrack(editor, 1)
    const undoBefore = editor.state.undoCount.value

    expect(editor.commands.replaceSegmentId(id, id)).toBe(true)
    expect(editor.state.undoCount.value).toBe(undoBefore)
  })

  it('reports failure for unknown ids', () => {
    const editor = createEditor()

    expect(editor.commands.replaceTrackId('missing', 'other')).toBe(false)
    expect(editor.commands.replaceSegmentId('missing', 'other')).toBe(false)
  })
})

describe('plugins', () => {
  function createPlugin(name: string, hooks: Partial<EditorCorePlugin> = {}) {
    return () => ({ name, ...hooks })
  }

  it('registers a plugin and initialises it on init', async () => {
    const editor = createEditor()
    const init = vi.fn()

    await editor.plugins.register(createPlugin('a', { init }))

    expect(editor.plugins.has('a')).toBe(true)
    expect(init).not.toHaveBeenCalled()

    await editor.plugins.init()

    expect(init).toHaveBeenCalledTimes(1)
  })

  it('initialises a plugin registered after init', async () => {
    const editor = createEditor()
    const init = vi.fn()

    await editor.plugins.init()
    await editor.plugins.register(createPlugin('late', { init }))

    expect(init).toHaveBeenCalledTimes(1)
  })

  it('refuses a duplicate name unless told to override', async () => {
    const editor = createEditor()
    const firstDestroy = vi.fn()

    await editor.plugins.register(createPlugin('a', { destroy: firstDestroy }))

    await expect(editor.plugins.register(createPlugin('a'))).rejects.toThrow('has been registered')

    await editor.plugins.register(createPlugin('a', { init: vi.fn() }), { override: true })

    // Overriding must dispose the plugin it replaces.
    expect(firstDestroy).toHaveBeenCalledTimes(1)
    expect(editor.plugins.has('a')).toBe(true)
  })

  it('removes a plugin and disposes it', async () => {
    const editor = createEditor()
    const destroy = vi.fn()

    await editor.plugins.register(createPlugin('a', { destroy }))

    expect(await editor.plugins.remove('a')).toBe(true)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(editor.plugins.has('a')).toBe(false)
    expect(await editor.plugins.remove('a')).toBe(false)
  })

  it('disposes every plugin when the editor is destroyed', async () => {
    const editor = createEditor()
    const destroyA = vi.fn()
    const destroyB = vi.fn()

    await editor.plugins.register(createPlugin('a', { destroy: destroyA }))
    await editor.plugins.register(createPlugin('b', { destroy: destroyB }))

    await editor.destroy()

    expect(destroyA).toHaveBeenCalledTimes(1)
    expect(destroyB).toHaveBeenCalledTimes(1)
    expect(editor.plugins.has('a')).toBe(false)
  })

  it('hands the plugin the editor context', async () => {
    const editor = createEditor()
    let seenId: string | undefined

    await editor.plugins.register(ctx => ({
      name: 'reads-context',
      init: () => {
        seenId = ctx.state.protocol.value.id
        ctx.commands.setCurrentTime(750)
      },
    }))
    await editor.plugins.init()

    expect(seenId).toBe('protocol-1')
    expect(editor.state.currentTime.value).toBe(750)
  })
})

describe('segment registry', () => {
  const plugin: SegmentPlugin = { type: 'text' }

  it('registers and lists segment plugins', () => {
    const editor = createEditor()

    editor.registry.segments.register(plugin)

    expect(editor.registry.segments.get('text')).toBe(plugin)
    expect(editor.registry.segments.list()).toEqual([plugin])
  })

  it('refuses a duplicate type unless told to override', () => {
    const editor = createEditor()
    const replacement: SegmentPlugin = { type: 'text' }

    editor.registry.segments.register(plugin)

    expect(() => editor.registry.segments.register(replacement)).toThrow('has been registered')

    editor.registry.segments.register(replacement, { override: true })

    expect(editor.registry.segments.get('text')).toBe(replacement)
  })

  it('keeps registries separate between editor instances', () => {
    const first = createEditor()
    const second = createEditor()

    first.registry.segments.register(plugin)

    expect(second.registry.segments.get('text')).toBeUndefined()
  })
})
