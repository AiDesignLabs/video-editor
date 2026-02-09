/// <reference types="vitest" />

import type {
  IAudioSegment,
  IEffectSegment,
  IFilterSegment,
  IImageFramesSegment,
  IStickerSegment,
  ITextSegment,
  IVideoProtocol,
  TrackUnion,
} from '@video-editor/shared'
import { ref } from '@vue/reactivity'
import { describe, expect, it, vi } from 'vitest'

const { audioManagerInstances } = vi.hoisted(() => ({
  audioManagerInstances: [] as Array<{
    protocol: IVideoProtocol
    setProtocol: ReturnType<typeof vi.fn>
    sync: ReturnType<typeof vi.fn>
    ensureMp4Audio: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@video-editor/protocol', () => ({
  createValidator: () => ({
    verify: (protocol: IVideoProtocol) => protocol,
  }),
  createResourceManager: () => ({
    add: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
  }),
  getResourceKey: (url: string) => url,
}))

vi.mock('@webav/av-cliper', () => ({
  MP4Clip: class {},
}))

vi.mock('opfs-tools', () => ({
  file: vi.fn(() => ({
    exists: vi.fn(async () => false),
  })),
}))

vi.mock('pixi.js', () => {
  class Container {
    public children: unknown[] = []

    addChild(...items: unknown[]) {
      this.children.push(...items)
      return items[0]
    }

    removeChildren() {
      const removed = this.children
      this.children = []
      return removed
    }

    destroy() {
      this.children = []
    }
  }

  class Sprite {
    public destroyed = false
    public texture: unknown

    constructor(texture?: unknown) {
      this.texture = texture
    }

    destroy() {
      this.destroyed = true
    }
  }

  class Texture {
    public source = { update: vi.fn() }

    static from() {
      return new Texture()
    }

    update() {}

    destroy() {}
  }

  return { Container, Sprite, Texture }
})

vi.mock('./audio-manager', () => {
  class AudioManager {
    public protocol: IVideoProtocol
    public setProtocol = vi.fn((protocol: IVideoProtocol) => {
      this.protocol = protocol
    })
    public sync = vi.fn()
    public ensureMp4Audio = vi.fn()
    public destroy = vi.fn()

    constructor(protocol: IVideoProtocol) {
      this.protocol = protocol
      audioManagerInstances.push(this)
    }
  }

  return { AudioManager }
})

import { createRenderer } from './renderer-core'

function createAudioSegment(id: string, startTime: number, endTime: number): IAudioSegment {
  return {
    id,
    segmentType: 'audio',
    url: `https://example.com/${id}.mp3`,
    startTime,
    endTime,
  }
}

function createFrameSegment(id: string, startTime: number, endTime: number): IImageFramesSegment {
  return {
    id,
    segmentType: 'frames',
    type: 'image',
    format: 'img',
    url: `https://example.com/${id}.png`,
    startTime,
    endTime,
  }
}

function createTextSegment(id: string, startTime: number, endTime: number, content = id): ITextSegment {
  return {
    id,
    segmentType: 'text',
    startTime,
    endTime,
    texts: [{ content }],
  }
}

function createStickerSegment(id: string, startTime: number, endTime: number): IStickerSegment {
  return {
    id,
    segmentType: 'sticker',
    format: 'img',
    url: `https://example.com/${id}.png`,
    startTime,
    endTime,
  }
}

function createEffectSegment(id: string, startTime: number, endTime: number, name = id): IEffectSegment {
  return {
    id,
    segmentType: 'effect',
    effectId: `effect-${id}`,
    name,
    startTime,
    endTime,
  }
}

function createFilterSegment(id: string, startTime: number, endTime: number, intensity = 0.5): IFilterSegment {
  return {
    id,
    segmentType: 'filter',
    filterId: `filter-${id}`,
    name: id,
    intensity,
    startTime,
    endTime,
  }
}

function createProtocol(segments: IAudioSegment[]): IVideoProtocol {
  return {
    id: 'renderer-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: segments,
      },
    ],
  }
}

function createMockApp() {
  return {
    stage: { addChild: vi.fn() },
    renderer: { width: 1280, height: 720 },
    render: vi.fn(),
  }
}

function getTrack<T extends TrackUnion['trackType']>(
  protocol: IVideoProtocol,
  trackId: string,
  trackType: T,
): Extract<TrackUnion, { trackType: T }> {
  const track = protocol.tracks.find(item => item.trackId === trackId && item.trackType === trackType)
  if (!track)
    throw new Error(`track not found: ${trackId} (${trackType})`)
  return track as Extract<TrackUnion, { trackType: T }>
}

function getAudioManagerInstance() {
  const audioManager = audioManagerInstances[0]
  expect(audioManager).toBeDefined()
  return audioManager!
}

function getLatestSyncedProtocol() {
  const audioManager = getAudioManagerInstance()
  const latest = audioManager.setProtocol.mock.calls.at(-1)?.[0] as IVideoProtocol | undefined
  expect(latest).toBeDefined()
  return latest!
}

async function flushReactivity() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createRenderer protocol sync', () => {
  it('updates AudioManager with latest protocol after deep mutation', async () => {
    audioManagerInstances.length = 0

    const protocol = ref(createProtocol([
      createAudioSegment('audio-1', 0, 1000),
      createAudioSegment('audio-2', 1000, 2000),
    ]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = audioManagerInstances[0]
      expect(audioManager).toBeDefined()
      expect(audioManager.setProtocol).toHaveBeenCalledTimes(1)

      protocol.value.tracks[0]!.children.splice(0, 1)
      await flushReactivity()

      expect(audioManager.setProtocol.mock.calls.length).toBeGreaterThanOrEqual(2)
      const latestProtocol = audioManager.setProtocol.mock.calls.at(-1)?.[0] as IVideoProtocol
      const latestIds = latestProtocol.tracks[0]!.children.map(segment => segment.id)
      expect(latestIds).toEqual(['audio-2'])
      expect(latestProtocol).not.toBe(protocol.value)
    }
    finally {
      renderer.destroy()
    }
  })

  it('updates AudioManager when protocol ref value is replaced', async () => {
    audioManagerInstances.length = 0

    const protocol = ref(createProtocol([
      createAudioSegment('audio-1', 0, 1000),
      createAudioSegment('audio-2', 1000, 2000),
    ]))

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = audioManagerInstances[0]
      expect(audioManager).toBeDefined()

      protocol.value = createProtocol([createAudioSegment('audio-2', 1000, 2000)])
      await flushReactivity()

      const latestProtocol = audioManager.setProtocol.mock.calls.at(-1)?.[0] as IVideoProtocol
      const latestIds = latestProtocol.tracks[0]!.children.map(segment => segment.id)
      expect(latestIds).toEqual(['audio-2'])
    }
    finally {
      renderer.destroy()
    }
  })
})

describe('createRenderer segment operations across types', () => {
  it('syncs add/update/remove operations for frames/text/sticker/effect/filter/audio', async () => {
    audioManagerInstances.length = 0

    const protocol = ref<IVideoProtocol>({
      id: 'renderer-segment-ops',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        { trackId: 'frames-track', trackType: 'frames', isMain: true, children: [createFrameSegment('frame-1', 0, 1000)] },
        { trackId: 'text-track', trackType: 'text', children: [createTextSegment('text-1', 0, 1000, 'hello')] },
        { trackId: 'sticker-track', trackType: 'sticker', children: [createStickerSegment('sticker-1', 0, 800)] },
        { trackId: 'audio-track', trackType: 'audio', children: [createAudioSegment('audio-1', 0, 1200)] },
        { trackId: 'effect-track', trackType: 'effect', children: [createEffectSegment('effect-1', 0, 1200, 'fx-a')] },
        { trackId: 'filter-track', trackType: 'filter', children: [createFilterSegment('filter-1', 0, 1200, 0.4)] },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const audioManager = getAudioManagerInstance()
      expect(audioManager.setProtocol).toHaveBeenCalledTimes(1)

      // frames: update (resize)
      const frame = getTrack(protocol.value, 'frames-track', 'frames').children[0] as IImageFramesSegment
      frame.startTime = 120
      frame.endTime = 980
      await flushReactivity()
      let latest = getLatestSyncedProtocol()
      const latestFrame = getTrack(latest, 'frames-track', 'frames').children[0] as IImageFramesSegment
      expect(latestFrame.startTime).toBe(120)
      expect(latestFrame.endTime).toBe(980)

      // text: update content + add segment
      const textTrack = getTrack(protocol.value, 'text-track', 'text')
      const text1 = textTrack.children[0] as ITextSegment
      text1.texts[0]!.content = 'world'
      textTrack.children.push(createTextSegment('text-2', 1000, 1800, 'new'))
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      const latestTextTrack = getTrack(latest, 'text-track', 'text')
      const latestText1 = latestTextTrack.children.find(item => item.id === 'text-1') as ITextSegment | undefined
      expect(latestText1?.texts[0]?.content).toBe('world')
      expect(latestTextTrack.children.map(item => item.id)).toEqual(['text-1', 'text-2'])

      // sticker: remove
      const stickerTrack = getTrack(protocol.value, 'sticker-track', 'sticker')
      stickerTrack.children.splice(0, 1)
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      expect(getTrack(latest, 'sticker-track', 'sticker').children).toHaveLength(0)

      // audio: remove + add
      const audioTrack = getTrack(protocol.value, 'audio-track', 'audio')
      audioTrack.children.splice(0, 1)
      audioTrack.children.push(createAudioSegment('audio-2', 200, 1000))
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      expect(getTrack(latest, 'audio-track', 'audio').children.map(item => item.id)).toEqual(['audio-2'])

      // effect: update name
      const effect = getTrack(protocol.value, 'effect-track', 'effect').children[0] as IEffectSegment
      effect.name = 'fx-b'
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      const latestEffect = getTrack(latest, 'effect-track', 'effect').children[0] as IEffectSegment
      expect(latestEffect.name).toBe('fx-b')

      // filter: add + update intensity
      const filterTrack = getTrack(protocol.value, 'filter-track', 'filter')
      const filter1 = filterTrack.children[0] as IFilterSegment
      filter1.intensity = 0.8
      filterTrack.children.push(createFilterSegment('filter-2', 1200, 2000, 0.3))
      await flushReactivity()
      latest = getLatestSyncedProtocol()
      const latestFilterTrack = getTrack(latest, 'filter-track', 'filter')
      const latestFilter1 = latestFilterTrack.children.find(item => item.id === 'filter-1') as IFilterSegment | undefined
      expect(latestFilter1?.intensity).toBe(0.8)
      expect(latestFilterTrack.children.map(item => item.id)).toEqual(['filter-1', 'filter-2'])
    }
    finally {
      renderer.destroy()
    }
  })

  it('syncs segment move across tracks', async () => {
    audioManagerInstances.length = 0

    const protocol = ref<IVideoProtocol>({
      id: 'renderer-segment-move',
      version: '1.0.0',
      width: 1280,
      height: 720,
      fps: 30,
      tracks: [
        { trackId: 'text-track-a', trackType: 'text', children: [createTextSegment('text-1', 0, 1000, 'a')] },
        { trackId: 'text-track-b', trackType: 'text', children: [createTextSegment('text-2', 1000, 1800, 'b')] },
      ],
    })

    const renderer = await createRenderer({
      protocol,
      app: createMockApp() as any,
      manualRender: true,
      warmUpResources: false,
    })

    try {
      const fromTrack = getTrack(protocol.value, 'text-track-a', 'text')
      const targetTrack = getTrack(protocol.value, 'text-track-b', 'text')
      const moving = fromTrack.children.splice(0, 1)[0] as ITextSegment | undefined
      expect(moving).toBeDefined()
      moving!.startTime = 1800
      moving!.endTime = 2400
      targetTrack.children.push(moving!)

      await flushReactivity()

      const latest = getLatestSyncedProtocol()
      expect(getTrack(latest, 'text-track-a', 'text').children.map(item => item.id)).toEqual([])
      const latestTarget = getTrack(latest, 'text-track-b', 'text').children
      expect(latestTarget.map(item => item.id)).toEqual(['text-2', 'text-1'])
      const moved = latestTarget.find(item => item.id === 'text-1') as ITextSegment | undefined
      expect(moved?.startTime).toBe(1800)
      expect(moved?.endTime).toBe(2400)
    }
    finally {
      renderer.destroy()
    }
  })
})
