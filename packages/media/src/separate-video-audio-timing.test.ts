import { beforeEach, describe, expect, it, vi } from 'vitest'
import { separateVideoAudio } from './separate-video-audio'

const state = vi.hoisted(() => ({ starts: [] as number[], videoStart: -0.3, audioStart: 0 }))
vi.mock('mediabunny', () => {
  const video = { getFirstTimestamp: async () => state.videoStart }
  const audio = { getFirstTimestamp: async () => state.audioStart }
  class Input {
    getPrimaryVideoTrack() { return video }
    getPrimaryAudioTrack() { return audio }
    dispose() {}
  }
  class BufferTarget { buffer = new ArrayBuffer(1) }
  class Conversion {
    static async init(options: { trim: { start: number } }) {
      state.starts.push(options.trim.start)
      return { isValid: true, discardedTracks: [], execute: async () => {} }
    }
  }
  class Empty {}
  return { ALL_FORMATS: [], BlobSource: Empty, BufferTarget, Conversion, Input, Mp4OutputFormat: Empty, Output: Empty, UrlSource: Empty }
})

beforeEach(() => {
  state.starts = []
})
describe('separateVideoAudio timing', () => {
  it('uses the earliest negative timestamp for both tracks', async () => {
    state.videoStart = -0.3
    state.audioStart = 0
    await separateVideoAudio(new Blob())
    expect(state.starts).toEqual([-0.3, -0.3])
  })
  it('retains leading time when both tracks start after zero', async () => {
    state.videoStart = 0.2
    state.audioStart = 0.5
    await separateVideoAudio(new Blob())
    expect(state.starts).toEqual([0, 0])
  })
})
