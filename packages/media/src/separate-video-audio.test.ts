import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openMediaInput } from './input'
import { separateVideoAudio } from './separate-video-audio'

const directory = mkdtempSync(join(tmpdir(), 'separate-video-audio-'))
const source = join(directory, 'source.mp4')
const silent = join(directory, 'silent.mp4')
beforeAll(() => {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-y', source])
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=1', '-c:v', 'libx264', '-an', '-y', silent])
})
afterAll(() => rmSync(directory, { recursive: true, force: true }))
describe('separateVideoAudio', () => {
  it('puts the video and audio tracks into separate outputs', async () => {
    const result = await separateVideoAudio(new Blob([readFileSync(source)]))
    const video = openMediaInput(result.video)
    const audio = openMediaInput(result.audio)
    try {
      expect(await video.meta({ includeFrameRate: false })).toMatchObject({ hasVideo: true, hasAudio: false })
      expect(await audio.meta({ includeFrameRate: false })).toMatchObject({ hasVideo: false, hasAudio: true })
    }
    finally {
      video.dispose()
      audio.dispose()
    }
  })
  it('rejects a source without an audio track', async () => {
    await expect(separateVideoAudio(new Blob([readFileSync(silent)]))).rejects.toThrow('source must contain video and audio tracks')
  })
})
