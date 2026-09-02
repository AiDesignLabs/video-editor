import type { IAudioSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import type { AudioVoiceAction, TimelinePlan } from './timeline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioManager } from './audio-manager'

interface MockAudioOptions {
  duration: number
  rejectNonZeroSeek: boolean
}

class MockAudioElement {
  static instances: MockAudioElement[] = []
  static options: MockAudioOptions = {
    duration: Number.NaN,
    rejectNonZeroSeek: false,
  }

  static reset(options?: Partial<MockAudioOptions>) {
    MockAudioElement.instances.length = 0
    MockAudioElement.options = {
      duration: Number.NaN,
      rejectNonZeroSeek: false,
      ...options,
    }
  }

  private sourceUrl: string
  readonly duration: number
  preload = 'auto'
  loop = false
  playsInline = false
  volume = 1
  playbackRate = 1
  private pausedFlag = true
  private currentTimeValue = 0
  private readonly rejectNonZeroSeek: boolean
  playCalls = 0
  pauseCalls = 0

  constructor(url: string) {
    this.sourceUrl = url
    this.duration = MockAudioElement.options.duration
    this.rejectNonZeroSeek = MockAudioElement.options.rejectNonZeroSeek
    MockAudioElement.instances.push(this)
  }

  get src() {
    return this.sourceUrl
  }

  set src(value: string) {
    this.sourceUrl = value
  }

  get url() {
    return this.sourceUrl
  }

  get paused() {
    return this.pausedFlag
  }

  get currentTime() {
    return this.currentTimeValue
  }

  set currentTime(value: number) {
    if (this.rejectNonZeroSeek && value > 0.05)
      throw new Error('seek rejected by media element')
    this.currentTimeValue = Math.max(0, value)
  }

  play() {
    this.pausedFlag = false
    this.playCalls += 1
    return Promise.resolve()
  }

  pause() {
    this.pausedFlag = true
    this.pauseCalls += 1
  }

  removeAttribute(_name: string) {}

  load() {}
}

class MockGainNode {
  gain = { value: 1 }
  connect() {}
  disconnect() {}
}

class MockAudioBuffer {
  readonly duration: number

  constructor(
    readonly channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = sampleRate > 0 ? length / sampleRate : 0
  }

  copyToChannel() {}
}

class MockBufferSource {
  playbackRate = { value: 1 }
  buffer?: MockAudioBuffer
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}

  resume() {
    this.state = 'running'
    return Promise.resolve()
  }

  createGain() {
    return new MockGainNode()
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer(channels, length, sampleRate)
  }

  createBufferSource() {
    return new MockBufferSource()
  }
}

function createProtocol(): IVideoProtocol {
  return {
    id: 'audio-manager-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: [
          {
            id: 'audio-1',
            segmentType: 'audio',
            url: 'https://example.com/audio.mp3',
            startTime: 0,
            endTime: 10000,
            volume: 1,
            playRate: 1,
          },
        ],
      },
    ],
  }
}

function createVideoAudioProtocol(): IVideoProtocol {
  const videoSegment: IVideoFramesSegment = {
    id: 'video-1',
    segmentType: 'frames',
    type: 'video',
    url: 'https://example.com/video.mp4',
    startTime: 0,
    endTime: 10000,
    fromTime: 500,
    volume: 0.7,
    playRate: 1.25,
  }

  return {
    id: 'video-audio-manager-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'frames-track',
        trackType: 'frames',
        isMain: true,
        children: [videoSegment],
      },
    ],
  }
}

function createReversedAudioProtocol(): IVideoProtocol {
  const audioSegment: IAudioSegment = {
    id: 'audio-1',
    segmentType: 'audio',
    url: 'https://example.com/audio.mp3',
    startTime: 0,
    endTime: 10000,
    fromTime: 500,
    volume: 0.8,
    playRate: 1,
    reversed: true,
  }

  return {
    id: 'reversed-audio-manager-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: [audioSegment],
      },
    ],
  }
}

function createPlan(action: AudioVoiceAction, sourceTimeMs: number, atTimelineMs: number = sourceTimeMs): TimelinePlan {
  return {
    atMs: atTimelineMs,
    windowStartMs: Math.max(0, atTimelineMs - 20),
    windowEndMs: atTimelineMs + 100,
    visuals: [],
    audioEvents: [
      {
        voiceId: 'audio:audio-1',
        segmentId: 'audio-1',
        trackId: 'audio-track',
        segmentKind: 'audio',
        action,
        atTimelineMs,
        sourceTimeMs,
        gain: 1,
        rate: 1,
      },
    ],
  }
}

function createVideoPlan(action: AudioVoiceAction, sourceTimeMs: number): TimelinePlan {
  return {
    atMs: sourceTimeMs,
    windowStartMs: Math.max(0, sourceTimeMs - 20),
    windowEndMs: sourceTimeMs + 100,
    visuals: [],
    audioEvents: [
      {
        voiceId: 'video:video-1',
        segmentId: 'video-1',
        trackId: 'frames-track',
        segmentKind: 'video',
        action,
        atTimelineMs: sourceTimeMs,
        sourceTimeMs,
        gain: 0.7,
        rate: 1.25,
      },
    ],
  }
}

describe('audioManager audio-element seek guards', () => {
  beforeEach(() => {
    MockAudioElement.reset()
    vi.stubGlobal('Audio', MockAudioElement as unknown as typeof Audio)
    vi.stubGlobal('document', {
      createElement: (tagName: string) => {
        if (tagName !== 'video')
          throw new Error(`Unexpected media element: ${tagName}`)
        return new MockAudioElement('')
      },
    })
    vi.stubGlobal('window', {
      AudioContext: MockAudioContext,
      webkitAudioContext: MockAudioContext,
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not play when source offset is beyond actual media duration', () => {
    MockAudioElement.reset({
      duration: 2,
    })
    const manager = new AudioManager(createProtocol())

    manager.applyTimelinePlan(createPlan('start', 3000), true)

    const element = MockAudioElement.instances[0]
    expect(element).toBeDefined()
    expect(element?.playCalls).toBe(0)
    expect(element?.pauseCalls).toBeGreaterThan(0)

    manager.destroy()
  })

  it('does not fallback to head playback when seek to non-zero source is rejected', () => {
    MockAudioElement.reset({
      duration: Number.NaN,
      rejectNonZeroSeek: true,
    })
    const manager = new AudioManager(createProtocol())

    manager.applyTimelinePlan(createPlan('start', 0), true)
    manager.applyTimelinePlan(createPlan('seek', 3000), true)

    const element = MockAudioElement.instances[0]
    expect(element).toBeDefined()
    expect(element?.playCalls).toBe(1)
    expect(element?.pauseCalls).toBeGreaterThan(0)

    manager.destroy()
  })

  it('plays video segment audio through a media element at the planned source time', () => {
    MockAudioElement.reset({
      duration: 8,
    })
    const manager = new AudioManager(createVideoAudioProtocol())

    manager.applyTimelinePlan(createVideoPlan('start', 1500), true)

    const element = MockAudioElement.instances[0]
    expect(element).toBeDefined()
    expect(element?.url).toBe('https://example.com/video.mp4')
    expect(element?.playsInline).toBe(true)
    expect(element?.currentTime).toBeCloseTo(1.5, 6)
    expect(element?.volume).toBeCloseTo(0.7, 6)
    expect(element?.playbackRate).toBeCloseTo(1.25, 6)
    expect(element?.playCalls).toBe(1)

    manager.destroy()
  })

  it('uses the resolved media element URL for video segment audio', () => {
    MockAudioElement.reset({
      duration: 8,
    })
    const manager = new AudioManager(createVideoAudioProtocol(), {
      resolveMediaElementUrl: segment => segment.id === 'video-1' ? 'blob:opfs-video' : undefined,
    })

    manager.applyTimelinePlan(createVideoPlan('start', 1500), true)

    const element = MockAudioElement.instances[0]
    expect(element).toBeDefined()
    expect(element?.url).toBe('blob:opfs-video')
    expect(element?.playCalls).toBe(1)

    manager.destroy()
  })

  it('waits for a playable URL before starting local asset audio', () => {
    MockAudioElement.reset({ duration: 8 })
    const protocol = createVideoAudioProtocol()
    const segment = protocol.tracks[0]?.children[0]
    if (!segment)
      throw new Error('Expected a video segment')
    segment.url = 'local-asset://video-1/video.mp4'
    let resolvedUrl: string | undefined
    const manager = new AudioManager(protocol, {
      resolveMediaElementUrl: () => resolvedUrl,
    })

    manager.applyTimelinePlan(createVideoPlan('start', 1500), true)
    expect(MockAudioElement.instances).toHaveLength(0)

    resolvedUrl = 'blob:opfs-video'
    manager.resetTimelineState()
    manager.applyTimelinePlan(createVideoPlan('start', 1500), true)

    expect(MockAudioElement.instances).toHaveLength(1)
    expect(MockAudioElement.instances[0]?.url).toBe('blob:opfs-video')
    expect(MockAudioElement.instances[0]?.playCalls).toBe(1)

    manager.destroy()
  })
})

describe('audioManager decoded buffer audio', () => {
  beforeEach(() => {
    MockAudioElement.reset()
    vi.stubGlobal('Audio', MockAudioElement as unknown as typeof Audio)
    vi.stubGlobal('document', {
      createElement: (tagName: string) => {
        if (tagName !== 'video')
          throw new Error(`Unexpected media element: ${tagName}`)
        return new MockAudioElement('')
      },
    })
    vi.stubGlobal('window', {
      AudioContext: MockAudioContext,
      webkitAudioContext: MockAudioContext,
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps forward video audio on the streaming media element path', () => {
    MockAudioElement.reset({ duration: 12 })
    const buffer = new MockAudioBuffer(2, 48000 * 12, 48000) as unknown as AudioBuffer
    const loadAudioBuffer = vi.fn(async () => buffer)
    const manager = new AudioManager(createVideoAudioProtocol(), { loadAudioBuffer })

    manager.applyTimelinePlan(createVideoPlan('start', 2000), true)

    expect(loadAudioBuffer).not.toHaveBeenCalled()
    expect(MockAudioElement.instances).toHaveLength(1)
    expect(MockAudioElement.instances[0]?.playCalls).toBe(1)

    manager.destroy()
  })

  it('uses the decoded buffer path for reversed video audio', async () => {
    const protocol = createVideoAudioProtocol()
    const segment = protocol.tracks[0]?.children[0]
    if (!segment || segment.segmentType !== 'frames' || segment.type !== 'video')
      throw new Error('Expected a video segment')
    segment.reversed = true
    const startSpy = vi.spyOn(MockBufferSource.prototype, 'start')
    const buffer = new MockAudioBuffer(2, 48000 * 12, 48000) as unknown as AudioBuffer
    const loadAudioBuffer = vi.fn(async () => buffer)
    const manager = new AudioManager(protocol, { loadAudioBuffer })

    manager.applyTimelinePlan(createVideoPlan('start', 2000), true)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(loadAudioBuffer).toHaveBeenCalledTimes(1)
    expect(MockAudioElement.instances).toHaveLength(0)
    expect(startSpy).toHaveBeenCalledTimes(1)

    manager.destroy()
  })

  it('plays reversed standalone audio through the decoded buffer path', async () => {
    const startSpy = vi.spyOn(MockBufferSource.prototype, 'start')
    const buffer = new MockAudioBuffer(2, 48000 * 10, 48000) as unknown as AudioBuffer
    const loadAudioBuffer = vi.fn(async () => buffer)
    const manager = new AudioManager(createReversedAudioProtocol(), { loadAudioBuffer })

    // At timeline 2s the reversed source window points at source 8.5s. The
    // reversed 0.5s..10.5s buffer therefore starts 2s into its data.
    manager.applyTimelinePlan(createPlan('start', 8500, 2000), true)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(loadAudioBuffer).toHaveBeenCalledTimes(1)
    expect(loadAudioBuffer).toHaveBeenCalledWith(expect.objectContaining({ id: 'audio-1', reversed: true }))
    expect(MockAudioElement.instances).toHaveLength(0)
    expect(startSpy).toHaveBeenCalledWith(0, 2)

    manager.destroy()
  })

  it('fails clearly when reversed standalone audio has no buffer loader', () => {
    const manager = new AudioManager(createReversedAudioProtocol())

    expect(() => manager.applyTimelinePlan(createPlan('start', 8500, 2000), true))
      .toThrow(/reversed audio preview requires a decoded audio buffer loader/)

    manager.destroy()
  })
})
