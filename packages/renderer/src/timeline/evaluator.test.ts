import type {
  IAudioSegment,
  IEffectSegment,
  IFilterSegment,
  IFramesSegmentUnion,
  IStickerSegment,
  ITransition,
  ITransitionEdge,
  IVideoFramesSegment,
  IVideoProtocol,
} from '@video-editor/shared'
import { describe, expect, it } from 'vitest'
import { createEmptyEvaluatorState, evaluateTimelinePlan } from './evaluator'

function createAudioSegment(overrides: Partial<IAudioSegment> = {}): IAudioSegment {
  return {
    id: 'audio-1',
    segmentType: 'audio',
    url: 'https://example.com/audio.mp3',
    startTime: 0,
    endTime: 1000,
    ...overrides,
  }
}

function createVideoSegment(
  id: string,
  startTime: number,
  endTime: number,
  overrides: Partial<IVideoFramesSegment> = {},
): IVideoFramesSegment {
  return {
    id,
    segmentType: 'frames',
    type: 'video',
    url: `https://example.com/${id}.mp4`,
    startTime,
    endTime,
    ...overrides,
  }
}

function createStickerSegment(
  id: string,
  startTime: number,
  endTime: number,
): IStickerSegment {
  return {
    id,
    segmentType: 'sticker',
    format: 'img',
    url: `https://example.com/${id}.png`,
    startTime,
    endTime,
  }
}

function createProtocol(input: {
  audio?: IAudioSegment[]
  frames?: IFramesSegmentUnion[]
  stickers?: IStickerSegment[]
  effects?: IEffectSegment[]
  filters?: IFilterSegment[]
  transitions?: ITransitionEdge[]
}): IVideoProtocol {
  return {
    id: 'timeline-evaluator-test',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'frames-main',
        trackType: 'frames',
        isMain: true,
        children: input.frames ?? [],
      },
      {
        trackId: 'sticker-track',
        trackType: 'sticker',
        children: input.stickers ?? [],
      },
      {
        trackId: 'effect-track',
        trackType: 'effect',
        children: input.effects ?? [],
      },
      {
        trackId: 'filter-track',
        trackType: 'filter',
        children: input.filters ?? [],
      },
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: input.audio ?? [],
      },
    ],
    transitions: input.transitions,
  }
}

describe('timeline evaluator', () => {
  it('emits start/gain/rate on activation and stop on deactivation', () => {
    const protocol = createProtocol({
      audio: [createAudioSegment()],
    })

    const first = evaluateTimelinePlan(protocol, {
      atMs: 200,
      windowStartMs: 100,
      windowEndMs: 300,
      fps: 30,
    })

    expect(first.state.activeVoices.map(voice => voice.voiceId)).toEqual(['audio:audio-1'])
    expect(first.plan.audioEvents.map(event => event.action)).toEqual(['start', 'gain', 'rate'])

    const second = evaluateTimelinePlan(protocol, {
      atMs: 1200,
      windowStartMs: 1100,
      windowEndMs: 1300,
      fps: 30,
    }, first.state)

    expect(second.state.activeVoices).toEqual([])
    expect(second.plan.audioEvents.map(event => event.action)).toEqual(['stop'])
  })

  it('maps source time using fromTime and playRate', () => {
    const protocol = createProtocol({
      audio: [
        createAudioSegment({
          fromTime: 500,
          playRate: 2,
          fadeInDuration: 200,
        }),
      ],
    })

    const output = evaluateTimelinePlan(protocol, {
      atMs: 100,
      windowStartMs: 0,
      windowEndMs: 200,
      fps: 30,
    }, createEmptyEvaluatorState())

    const startEvent = output.plan.audioEvents.find(event => event.action === 'start')
    expect(startEvent).toBeDefined()
    expect(startEvent?.sourceTimeMs).toBeCloseTo(700, 6)
    expect(startEvent?.gain).toBeCloseTo(0.5, 6)
    expect(startEvent?.rate).toBe(2)
  })

  it('emits seek event for active voices on discontinuity', () => {
    const protocol = createProtocol({
      audio: [createAudioSegment()],
    })

    const first = evaluateTimelinePlan(protocol, {
      atMs: 200,
      windowStartMs: 100,
      windowEndMs: 300,
      fps: 30,
    })

    const second = evaluateTimelinePlan(protocol, {
      atMs: 600,
      windowStartMs: 500,
      windowEndMs: 700,
      fps: 30,
      discontinuity: true,
    }, first.state)

    expect(second.plan.audioEvents.map(event => event.action)).toContain('seek')
    const seekEvent = second.plan.audioEvents.find(event => event.action === 'seek')
    expect(seekEvent?.sourceTimeMs).toBeCloseTo(600, 6)
  })

  it('computes transition progress and keeps visual ordering deterministic', () => {
    const transition: ITransition = {
      id: 'transition-1',
      name: 'crossfade',
      duration: 200,
    }
    const protocol = createProtocol({
      frames: [
        createVideoSegment('video-1', 0, 1000),
        createVideoSegment('video-2', 1000, 2000),
      ],
      transitions: [{
        id: transition.id,
        name: transition.name,
        duration: transition.duration,
        fromSegmentId: 'video-1',
        toSegmentId: 'video-2',
      }],
      stickers: [createStickerSegment('sticker-1', 0, 2000)],
    })

    const output = evaluateTimelinePlan(protocol, {
      atMs: 900,
      windowStartMs: 850,
      windowEndMs: 950,
      fps: 30,
    })

    const visuals = output.plan.visuals
    expect(visuals.length).toBe(2)
    expect(visuals[0]?.segmentId).toBe('video-1')
    expect(visuals[1]?.segmentId).toBe('sticker-1')
    expect(visuals[0]?.transition?.toSegmentId).toBe('video-2')
    expect(visuals[0]?.transition?.progress).toBeCloseTo(0.5, 6)
    expect(visuals[0]?.transition?.durationMs).toBe(200)
  })

  it('prefers explicit transition edge from protocol.transitions', () => {
    const protocol = createProtocol({
      frames: [
        createVideoSegment('video-1', 0, 1000),
        createVideoSegment('video-2', 1000, 2000),
      ],
      transitions: [{
        id: 'edge-transition',
        name: 'edge',
        duration: 400,
        fromSegmentId: 'video-1',
        toSegmentId: 'video-2',
      }],
    })

    const output = evaluateTimelinePlan(protocol, {
      atMs: 900,
      windowStartMs: 850,
      windowEndMs: 950,
      fps: 30,
    })

    const [visual] = output.plan.visuals
    expect(visual?.transition?.transitionId).toBe('edge-transition')
    expect(visual?.transition?.progress).toBeCloseTo(0.75, 6)
    expect(visual?.transition?.durationMs).toBe(400)
  })

  it('ignores explicit transition edges when segments are not adjacent', () => {
    const protocol = createProtocol({
      frames: [
        createVideoSegment('video-1', 0, 1000),
        createVideoSegment('video-2', 1000, 2000),
        createVideoSegment('video-3', 2000, 3000),
      ],
      transitions: [{
        id: 'edge-transition',
        name: 'edge',
        duration: 400,
        fromSegmentId: 'video-1',
        toSegmentId: 'video-3',
      }],
    })

    const output = evaluateTimelinePlan(protocol, {
      atMs: 900,
      windowStartMs: 850,
      windowEndMs: 950,
      fps: 30,
    })

    const [visual] = output.plan.visuals
    expect(visual?.transition).toBeUndefined()
  })

  it('supports transitions on image frames segments', () => {
    const protocol = createProtocol({
      frames: [
        {
          id: 'image-1',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: 'https://example.com/image-1.png',
          startTime: 0,
          endTime: 1000,
        },
        {
          id: 'image-2',
          segmentType: 'frames',
          type: 'image',
          format: 'img',
          url: 'https://example.com/image-2.png',
          startTime: 1000,
          endTime: 2000,
        },
      ],
      transitions: [{
        id: 'image-transition',
        name: 'crossfade',
        duration: 200,
        fromSegmentId: 'image-1',
        toSegmentId: 'image-2',
      }],
    })

    const output = evaluateTimelinePlan(protocol, {
      atMs: 900,
      windowStartMs: 850,
      windowEndMs: 950,
      fps: 30,
    })

    const [visual] = output.plan.visuals
    expect(visual?.segmentId).toBe('image-1')
    expect(visual?.transition?.toSegmentId).toBe('image-2')
    expect(visual?.transition?.progress).toBeCloseTo(0.5, 6)
  })

  it('attaches active effects and filters to visual plan items', () => {
    const protocol = createProtocol({
      frames: [createVideoSegment('video-1', 0, 1000)],
      effects: [{
        id: 'effect-1',
        segmentType: 'effect',
        effectId: 'fx-1',
        name: 'glow',
        startTime: 100,
        endTime: 900,
      }],
      filters: [{
        id: 'filter-1',
        segmentType: 'filter',
        filterId: 'flt-1',
        name: 'warm',
        intensity: 0.6,
        startTime: 100,
        endTime: 900,
      }],
    })

    const output = evaluateTimelinePlan(protocol, {
      atMs: 500,
      windowStartMs: 450,
      windowEndMs: 550,
      fps: 30,
    })

    expect(output.plan.visuals).toHaveLength(1)
    const [visual] = output.plan.visuals
    expect(visual?.segmentId).toBe('video-1')
    const effects = visual?.effects ?? []
    expect(effects).toHaveLength(2)
    expect(effects[0]?.segmentType).toBe('effect')
    expect(effects[1]?.segmentType).toBe('filter')
    const filter = effects.find(effect => effect.segmentType === 'filter')
    expect(filter?.intensity).toBeCloseTo(0.6, 6)
  })
})
