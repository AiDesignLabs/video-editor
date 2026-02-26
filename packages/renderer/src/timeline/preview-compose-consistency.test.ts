import type { IVideoProtocol } from '@video-editor/shared'
import type { TimelinePlan } from './types'
import { describe, expect, it } from 'vitest'
import { createComposeAudioInputs } from './compose-audio-plan'
import { createEmptyEvaluatorState, evaluateTimelinePlan } from './evaluator'

interface VoiceSample {
  sourceTimeMs: number
  gain: number
  rate: number
}

function createProtocol(): IVideoProtocol {
  return {
    id: 'preview-compose-consistency',
    version: '1.0.0',
    width: 1280,
    height: 720,
    fps: 30,
    tracks: [
      {
        trackId: 'frames-main',
        trackType: 'frames',
        isMain: true,
        children: [
          {
            id: 'video-1',
            segmentType: 'frames',
            type: 'video',
            url: 'https://example.com/video-1.mp4',
            startTime: 100,
            endTime: 1300,
            fromTime: 250,
            playRate: 1.25,
            volume: 0.7,
          },
        ],
      },
      {
        trackId: 'audio-track',
        trackType: 'audio',
        children: [
          {
            id: 'audio-1',
            segmentType: 'audio',
            url: 'https://example.com/audio-1.mp3',
            startTime: 0,
            endTime: 1000,
            fromTime: 100,
            playRate: 1.5,
            volume: 0.9,
            fadeInDuration: 200,
            fadeOutDuration: 300,
          },
          {
            id: 'audio-2',
            segmentType: 'audio',
            url: 'https://example.com/audio-2.mp3',
            startTime: 1000,
            endTime: 1800,
            fromTime: 50,
            playRate: 0.8,
            volume: 0.6,
            fadeInDuration: 100,
            fadeOutDuration: 100,
          },
          {
            id: 'audio-muted',
            segmentType: 'audio',
            url: 'https://example.com/audio-muted.mp3',
            startTime: 300,
            endTime: 700,
            volume: 0,
          },
        ],
      },
    ],
  }
}

function collectKeyMoments(protocol: IVideoProtocol): number[] {
  const points = new Set<number>([0])
  for (const track of protocol.tracks) {
    for (const segment of track.children) {
      if (segment.endTime <= segment.startTime)
        continue
      points.add(segment.startTime)
      points.add(Math.max(segment.startTime, segment.endTime - 1))
      points.add(segment.startTime + Math.floor((segment.endTime - segment.startTime) / 2))
    }
  }
  return [...points]
    .filter(time => Number.isFinite(time) && time >= 0)
    .sort((a, b) => a - b)
}

function extractPreviewVoices(plan: TimelinePlan): Map<string, VoiceSample> {
  const voices = new Map<string, VoiceSample>()
  for (const event of plan.audioEvents) {
    if (event.action === 'stop')
      continue
    const voice = voices.get(event.voiceId) ?? {
      sourceTimeMs: 0,
      gain: 1,
      rate: 1,
    }
    if (event.action === 'start' || event.action === 'seek') {
      if (typeof event.sourceTimeMs === 'number')
        voice.sourceTimeMs = event.sourceTimeMs
      if (typeof event.gain === 'number')
        voice.gain = event.gain
      if (typeof event.rate === 'number')
        voice.rate = event.rate
    }
    else if (event.action === 'gain' && typeof event.gain === 'number') {
      voice.gain = event.gain
    }
    else if (event.action === 'rate' && typeof event.rate === 'number') {
      voice.rate = event.rate
    }
    voices.set(event.voiceId, voice)
  }
  return voices
}

function extractComposeVoices(protocol: IVideoProtocol, atMs: number): Map<string, VoiceSample> {
  const inputs = createComposeAudioInputs(protocol)
  const voices = new Map<string, VoiceSample>()
  for (const input of inputs) {
    if (atMs < input.startTime || atMs >= input.endTime)
      continue
    const playRate = normalizePlayRate(input.playRate)
    const sourceTimeMs = Math.max(0, (input.fromTime ?? 0) + (atMs - input.startTime) * playRate)
    const voiceId = `${input.segmentKind}:${input.segmentId}`
    voices.set(voiceId, {
      sourceTimeMs,
      gain: resolveComposeGain(input, atMs),
      rate: playRate,
    })
  }
  return voices
}

function filterMutedVoicesBySegmentVolume(
  protocol: IVideoProtocol,
  voices: Map<string, VoiceSample>,
): Map<string, VoiceSample> {
  const volumeByVoiceId = new Map<string, number>()
  for (const track of protocol.tracks) {
    for (const segment of track.children) {
      if (segment.segmentType === 'audio')
        volumeByVoiceId.set(`audio:${segment.id}`, normalizeVolume(segment.volume))
      else if (segment.segmentType === 'frames' && segment.type === 'video')
        volumeByVoiceId.set(`video:${segment.id}`, normalizeVolume(segment.volume))
    }
  }

  const filtered = new Map<string, VoiceSample>()
  for (const [voiceId, voice] of voices) {
    const baseVolume = volumeByVoiceId.get(voiceId)
    if (typeof baseVolume === 'number' && baseVolume <= 0)
      continue
    filtered.set(voiceId, voice)
  }
  return filtered
}

function resolveComposeGain(
  input: {
    startTime: number
    endTime: number
    volume?: number
    fadeInDuration?: number
    fadeOutDuration?: number
    segmentKind: 'audio' | 'video'
  },
  atMs: number,
): number {
  const base = normalizeVolume(input.volume)
  if (input.segmentKind === 'video')
    return base
  const relative = Math.max(0, atMs - input.startTime)
  const duration = Math.max(0, input.endTime - input.startTime)
  const fadeIn = Math.max(0, Math.min(input.fadeInDuration ?? 0, duration))
  const fadeOut = Math.max(0, Math.min(input.fadeOutDuration ?? 0, duration))

  let envelope = 1
  if (fadeIn > 0 && relative < fadeIn)
    envelope = Math.max(0, relative / fadeIn)

  const remaining = duration - relative
  if (fadeOut > 0 && remaining < fadeOut)
    envelope = Math.min(envelope, Math.max(0, remaining / fadeOut))

  return base * envelope
}

function normalizePlayRate(playRate?: number): number {
  if (typeof playRate !== 'number' || !Number.isFinite(playRate))
    return 1
  return Math.max(0.1, Math.min(100, playRate))
}

function normalizeVolume(volume?: number): number {
  if (typeof volume !== 'number' || !Number.isFinite(volume))
    return 1
  return Math.max(0, Math.min(1, volume))
}

describe('preview/compose consistency', () => {
  it('keeps voice source-time/gain/rate aligned at key moments', () => {
    const protocol = createProtocol()
    const keyMoments = collectKeyMoments(protocol)

    for (const atMs of keyMoments) {
      const plan = evaluateTimelinePlan(protocol, {
        atMs,
        windowStartMs: atMs,
        windowEndMs: atMs,
        fps: Math.max(protocol.fps || 30, 1),
      }, createEmptyEvaluatorState()).plan
      const previewVoices = filterMutedVoicesBySegmentVolume(protocol, extractPreviewVoices(plan))
      const composeVoices = extractComposeVoices(protocol, atMs)

      expect([...composeVoices.keys()].sort(), `voice set @${atMs}ms`).toEqual([...previewVoices.keys()].sort())

      for (const [voiceId, previewVoice] of previewVoices) {
        const composeVoice = composeVoices.get(voiceId)
        expect(composeVoice, `missing compose voice ${voiceId} @${atMs}ms`).toBeDefined()
        expect(composeVoice!.sourceTimeMs, `${voiceId} source @${atMs}ms`).toBeCloseTo(previewVoice.sourceTimeMs, 6)
        expect(composeVoice!.gain, `${voiceId} gain @${atMs}ms`).toBeCloseTo(previewVoice.gain, 6)
        expect(composeVoice!.rate, `${voiceId} rate @${atMs}ms`).toBeCloseTo(previewVoice.rate, 6)
      }
    }
  })
})
