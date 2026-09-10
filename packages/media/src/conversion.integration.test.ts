import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { build, createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MEDIA_CONVERSION_SDK_VERSION } from './conversion'

let directory: string
let server: Awaited<ReturnType<typeof createServer>>
let browser: Awaited<ReturnType<typeof chromium.launch>>
let origin: string

beforeAll(async () => {
  expect(JSON.parse(await readFile(resolve('node_modules/mediabunny/package.json'), 'utf8')).version).toBe(MEDIA_CONVERSION_SDK_VERSION)
  execFileSync('ffmpeg', ['-version'])
  execFileSync('ffprobe', ['-version'])
  directory = await mkdtemp(resolve(tmpdir(), 'media-conversion-'))
  const production = process.env.MEDIA_TEST_BUILD === 'production'
  const builtDirectory = resolve(directory, 'build')
  if (production) {
    await build({ configFile: false, root: resolve('.'), base: '/built/', logLevel: 'error', worker: { format: 'es' }, build: { outDir: builtDirectory, target: 'esnext', minify: true, rollupOptions: { input: resolve('test/conversion-entry.ts'), output: { entryFileNames: 'entry.js' } } } })
  }
  if (process.env.MEDIA_TEST_BASE_REF) {
    const baseline = execFileSync('git', ['show', `${process.env.MEDIA_TEST_BASE_REF}:packages/media/src/transcode.ts`], { cwd: resolve('../..') }).toString().replaceAll('\'./encoder\'', JSON.stringify(resolve('src/encoder.ts'))).replaceAll('\'./types\'', JSON.stringify(resolve('src/types.ts')))
    await writeFile(resolve(directory, 'baseline.ts'), baseline)
    await writeFile(resolve(directory, 'baseline-worker.ts'), `
      import { transcode } from './baseline';
      globalThis.onmessage = async ({ data }) => {
        try {
          const chunks = new Map();
          const start = performance.now();
          await transcode({ source: data, renditions: [{id:'master',height:96,videoBitrate:300000},{id:'proxy',height:48,videoBitrate:100000}], audioBitrate:192000,
            openSink(rendition) { const bytes=[]; chunks.set(rendition.id,bytes); return new WritableStream({write(chunk){bytes.push(new Uint8Array(chunk));}}); }
          });
          globalThis.postMessage({elapsedMs:performance.now()-start,sizes:[...chunks.values()].map(bytes=>new Blob(bytes).size)});
        } catch(error) { globalThis.postMessage({error:String(error)}); }
      };
    `)
    await build({ configFile: false, root: resolve('.'), logLevel: 'error', resolve: { alias: { mediabunny: resolve('node_modules/mediabunny/dist/modules/src/index.js') } }, build: { outDir: builtDirectory, emptyOutDir: false, target: 'esnext', minify: true, rollupOptions: { input: resolve(directory, 'baseline-worker.ts'), output: { entryFileNames: 'baseline.js' } } } })
  }
  const generate = (name: string, audio: string[], video: string[] = [], container = 'mov') => {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=128x96:rate=25:duration=3', ...audio, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...video, '-y', resolve(directory, `${name}.${container}`)])
  }
  for (const rate of [32_000, 44_100, 48_000]) {
    generate(`audio-${rate}`, ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${rate}:duration=3`, '-c:a', 'pcm_s16le', '-ac', '2'])
  }
  generate('no-audio', ['-an'], [], 'mp4')
  generate('mono', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=3', '-c:a', 'pcm_s16le', '-ac', '1'])
  generate('surround', ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=5.1:sample_rate=48000:d=3', '-c:a', 'pcm_s16le'])
  generate('offset', ['-itsoffset', '0.4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=2.6', '-c:a', 'pcm_s16le'])
  generate('offset-aac', ['-itsoffset', '0.4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2.6', '-c:a', 'aac'], [], 'mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-itsoffset', '0.4', '-f', 'lavfi', '-i', 'testsrc2=size=128x96:rate=25:duration=2.6', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-fps_mode', 'vfr', '-c:a', 'aac', '-y', resolve(directory, 'video-offset-aac.mp4')])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', resolve(directory, 'audio-32000.mov'), '-c', 'copy', '-metadata:s:v:0', 'rotate=90', '-y', resolve(directory, 'rotated.mov')])
  generate('negative-aac', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=3', '-c:a', 'aac', '-b:a', '192k'], [], 'mp4')
  generate('vfr', ['-an'], ['-vf', 'select=\'if(lt(t,1),1,not(mod(n,2)))\'', '-fps_mode', 'vfr'], 'mp4')
  generate('cfr60', ['-an'], ['-r', '60'], 'mp4')
  generate('cfr2997', ['-an'], ['-r', '30000/1001'], 'mp4')
  generate('hdr', ['-an'], ['-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc'], 'mp4')
  generate('hevc-10bit', ['-an'], ['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error:pools=1'], 'mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:size=128x96:rate=25:duration=3,drawbox=color=white:t=fill:enable=\'between(mod(t,1),0.25,0.5)\'', '-f', 'lavfi', '-i', 'aevalsrc=\'sin(2*PI*440*t)*between(mod(t,1),0.25,0.5)\':s=32000:d=3', '-c:v', 'libx264', '-c:a', 'pcm_s16le', '-y', resolve(directory, 'sync.mov')])
  if (process.env.MEDIA_TEST_LARGE === '1') {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=120', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=120', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '65M', '-minrate', '65M', '-maxrate', '65M', '-bufsize', '130M', '-x264-params', 'nal-hrd=cbr', '-c:a', process.env.MEDIA_TEST_BASE_REF ? 'pcm_s16le' : 'aac', '-b:a', '192k', '-y', resolve(directory, 'large.mov')])
  }
  server = await createServer({ configFile: false, root: resolve('.'), server: { host: '127.0.0.1', port: 0 }, worker: { format: 'es' }, plugins: [{ name: 'conversion-fixtures', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/')
        return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(`<!doctype html><title>Media integration</title><input id="file" type="file"><script type="module" src="${production ? '/built/entry.js' : '/test/conversion-entry.ts'}"></script>`)
    })
    server.middlewares.use('/built', (req, res) => {
      const path = resolve(builtDirectory, `.${req.url ?? ''}`)
      if (!path.startsWith(`${builtDirectory}/`)) {
        res.statusCode = 403
        res.end()
        return
      }
      res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/javascript')
      createReadStream(path).on('error', () => {
        res.statusCode = 404
        res.end()
      }).pipe(res)
    })
    server.middlewares.use('/fixture', (req, res) => {
      const name = (req.url ?? '').slice(1)
      if (!/^[\w-]+\.(?:mov|mp4)$/.test(name)) {
        res.statusCode = 404
        res.end()
        return
      }
      createReadStream(resolve(directory, name)).pipe(res)
    })
  } }] })
  await server.listen()
  origin = server.resolvedUrls!.local[0]!
  browser = await chromium.launch({ headless: true, channel: process.env.MEDIA_TEST_BROWSER || 'chrome' })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
  if (directory)
    await rm(directory, { recursive: true, force: true })
})

describe('real browser Worker file conversion', () => {
  it.each(['negative-aac.mp4', 'offset-aac.mp4', 'video-offset-aac.mp4'])('preserves AAC packets and playback timing through Asset Service for %s', async (name) => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async (name) => {
        const source = await (await fetch(`/fixture/${name}`)).blob()
        const result = await window.convertMedia(source, false, true)
        if (result.error)
          throw new Error(result.error)
        const durations = []
        for (const file of result.files) {
          const video = document.createElement('video')
          const url = URL.createObjectURL(file)
          const ready = new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => resolve()
            video.onerror = () => reject(new Error('Video metadata failed'))
          })
          video.src = url
          await ready
          durations.push(video.duration)
          video.removeAttribute('src')
          video.load()
          URL.revokeObjectURL(url)
        }
        return { bytes: await Promise.all(result.files.map(async file => Array.from(new Uint8Array(await file.arrayBuffer())))), durations }
      }, name)
      const packets = (path: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', path]).toString()).packets.map((packet: { data_hash: string }) => packet.data_hash)
      const originalPackets = packets(resolve(directory, name))
      const decode = (path: string) => execFileSync('ffmpeg', ['-v', 'error', '-copyts', '-i', path, '-vn', '-af', 'aresample=48000:async=1:first_pts=0', '-ac', '1', '-f', 'f32le', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 })
      const originalAudio = decode(resolve(directory, name))
      for (const [index, bytes] of result.bytes.entries()) {
        const path = resolve(directory, `${name}-preserved-${index}.mp4`)
        await writeFile(path, Buffer.from(bytes))
        expect(packets(path)).toEqual(originalPackets)
        const convertedAudio = decode(path)
        const overlap = Math.min(originalAudio.length, convertedAudio.length)
        expect(convertedAudio.length).toBeGreaterThanOrEqual(Math.min(originalAudio.length, 3 * 48_000 * 4))
        expect(convertedAudio.subarray(0, overlap).equals(originalAudio.subarray(0, overlap))).toBe(true)
        expect(Math.abs(result.durations[index]! - 3)).toBeLessThan(0.05)
      }
    }
    finally { await page.close() }
  }, 30_000)

  it.runIf(process.env.MEDIA_TEST_BOUNDARIES === '1')('records actual fMP4 playback boundaries and quality-switch seeking', async () => {
    const page = await browser.newPage()
    const reports = []
    const audioBounds = (path: string) => {
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-copyts', '-i', path, '-vn', '-af', 'aresample=48000:async=1:first_pts=0', '-ac', '1', '-f', 'f32le', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 })
      let first = -1
      let last = -1
      for (let index = 0; index < pcm.length / 4; index++) {
        if (Math.abs(pcm.readFloatLE(index * 4)) > 0.001) {
          if (first < 0)
            first = index
          last = index
        }
      }
      return { firstAudibleSec: first / 48_000, lastAudibleSec: last / 48_000, decodedDurationSec: pcm.length / 4 / 48_000 }
    }
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      for (const name of ['audio-48000.mov', 'offset.mov', 'offset-aac.mp4']) {
        const result = await page.evaluate(async (name) => {
          const source = await (await fetch(`/fixture/${name}`)).blob()
          const result = await window.convertMedia(source, false, false, false, 'shared')
          if (result.error)
            throw new Error(result.error)
          const urls = [source, ...result.files].map(file => URL.createObjectURL(file))
          const playback = []
          const video = document.createElement('video')
          video.muted = true
          video.playsInline = true
          video.width = 320
          video.height = 240
          document.body.append(video)
          const load = async (url: string) => {
            const ready = new Promise<void>((resolve, reject) => {
              video.onloadeddata = () => resolve()
              video.onerror = () => reject(new Error('Native video playback failed'))
            })
            video.src = url
            await ready
          }
          const seek = async (time: number) => {
            if (Math.abs(video.currentTime - time) < 0.0001)
              return
            const done = new Promise<void>(resolve => video.onseeked = () => resolve())
            video.currentTime = time
            await done
          }
          try {
            for (const url of urls.slice(0, 2)) {
              await load(url)
              let lastFrameSec = 0
              let callbackId = 0
              const frame: VideoFrameRequestCallback = (_now, metadata) => {
                lastFrameSec = metadata.mediaTime
                callbackId = video.requestVideoFrameCallback(frame)
              }
              callbackId = video.requestVideoFrameCallback(frame)
              const ended = new Promise<void>(resolve => video.onended = () => resolve())
              await video.play()
              await ended
              video.cancelVideoFrameCallback(callbackId)
              const quality = video.getVideoPlaybackQuality()
              playback.push({ duration: video.duration, endedAt: video.currentTime, lastPresentedFrame: lastFrameSec, quality: { totalVideoFrames: quality.totalVideoFrames, droppedVideoFrames: quality.droppedVideoFrames } })
            }
            await load(urls[1]!)
            await seek(1.4)
            const before = video.currentTime
            await load(urls[2]!)
            await seek(before)
            const after = video.currentTime
            await seek(2.99)
            const nearOriginalEnd = video.currentTime
            await seek(video.duration - 0.01)
            const nearReportedEnd = video.currentTime
            video.loop = true
            const wrapped = new Promise<number>((resolve) => {
              const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
                if (metadata.mediaTime < 0.2)
                  resolve(video.currentTime)
                else
                  video.requestVideoFrameCallback(onFrame)
              }
              video.requestVideoFrameCallback(onFrame)
            })
            await video.play()
            const loopRestart = await wrapped
            video.pause()
            return { playback, before, after, nearOriginalEnd, nearReportedEnd, loopRestart, bytes: Array.from(new Uint8Array(await result.files[0]!.arrayBuffer())) }
          }
          finally {
            video.pause()
            video.removeAttribute('src')
            video.load()
            video.remove()
            urls.forEach(url => URL.revokeObjectURL(url))
          }
        }, name)
        const outputPath = resolve(directory, `boundary-${name}.mp4`)
        await writeFile(outputPath, Buffer.from(result.bytes))
        const { bytes: _bytes, ...playback } = result
        const originalAudio = audioBounds(resolve(directory, name))
        const convertedAudio = audioBounds(outputPath)
        const report = { name, ...playback, originalAudio, convertedAudio, trailingAudioCutIfStoppedAtSourceEndMs: Math.max(0, convertedAudio.lastAudibleSec - result.playback[0]!.duration) * 1000, extraPlaybackMs: (result.playback[1]!.duration - result.playback[0]!.duration) * 1000 }
        expect(result.after).toBeCloseTo(result.before, 3)
        expect(result.loopRestart).toBeLessThan(0.2)
        reports.push(report)
        process.stdout.write(`${JSON.stringify(report)}\n`)
      }
      if (process.env.MEDIA_BOUNDARY_REPORT)
        await writeFile(process.env.MEDIA_BOUNDARY_REPORT, JSON.stringify(reports, null, 2))
    }
    finally { await page.close() }
  }, 90_000)

  it.runIf(process.env.MEDIA_TEST_DIAGNOSTICS === '1')('measures SDK timing and fan-out decoder work', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      for (const name of ['offset.mov', 'offset-aac.mp4', 'negative-aac.mp4', 'no-audio.mp4']) {
        for (const mode of ['fragmented', 'flat', 'bounded', 'fanout', 'flat-software', 'fragmented-software', 'shared', 'fragmented-copy-audio', 'flat-copy-audio'] as const) {
          const result = await page.evaluate(async ({ name, mode }) => {
            const result = await window.convertMedia(await (await fetch(`/fixture/${name}`)).blob(), false, false, false, mode)
            if (result.error)
              throw new Error(result.error)
            const video = document.createElement('video')
            const url = URL.createObjectURL(result.files[0]!)
            const ready = new Promise<void>((resolve, reject) => {
              video.onloadedmetadata = () => resolve()
              video.onerror = () => reject(new Error('Video metadata failed'))
            })
            video.src = url
            await ready
            const nativeDuration = video.duration
            video.removeAttribute('src')
            video.load()
            URL.revokeObjectURL(url)
            return { bytes: Array.from(new Uint8Array(await result.files[0]!.arrayBuffer())), otherBytes: await Promise.all(result.files.slice(1).map(async file => Array.from(new Uint8Array(await file.arrayBuffer())))), diagnostic: result.diagnostic, nativeDuration }
          }, { name, mode })
          const path = resolve(directory, `${name}-${mode}.mp4`)
          await writeFile(path, Buffer.from(result.bytes))
          const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]).toString())
          if (mode === 'shared') {
            expect(result.otherBytes).toHaveLength(1)
            const secondaryPath = resolve(directory, `${name}-secondary.mp4`)
            await writeFile(secondaryPath, Buffer.from(result.otherBytes[0]!))
            const secondaryProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-count_packets', '-of', 'json', secondaryPath]).toString())
            expect(secondaryProbe.streams[0]).toMatchObject({ height: 24, nb_read_packets: '75' })
            expect(result.diagnostic?.decodedPackets).toBe(75)
          }
          let onset: number | undefined
          if (name !== 'no-audio.mp4') {
            const pcm = execFileSync('ffmpeg', ['-v', 'error', '-copyts', '-i', path, '-vn', '-af', 'aresample=48000:async=1:first_pts=0', '-ac', '1', '-f', 'f32le', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 })
            for (let index = 0; index < pcm.length / 4; index++) {
              if (Math.abs(pcm.readFloatLE(index * 4)) > 0.01) {
                onset = index / 48_000
                break
              }
            }
          }
          process.stdout.write(`${JSON.stringify({ name, mode, ...result.diagnostic, nativeDuration: result.nativeDuration, duration: probe.format.duration, onset, tracks: probe.streams.map((track: { codec_type: string, start_time: string, duration: string }) => ({ type: track.codec_type, start: track.start_time, duration: track.duration })) })}\n`)
        }
      }
    }
    finally { await page.close() }
  }, 60_000)

  it.runIf(process.env.MEDIA_TEST_LARGE === '1')('converts a near-1GB local MOV without reading the source into a page buffer', async () => {
    const sourcePath = resolve(directory, 'large.mov')
    const bytes = (await stat(sourcePath)).size
    expect(bytes).toBeGreaterThan(900_000_000)
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      await page.locator('#file').setInputFiles(sourcePath)
      const result = await page.evaluate(async (compare) => {
        const source = (document.querySelector('#file') as HTMLInputElement).files![0]!
        const started = performance.now()
        const result = await window.convertMedia(source, false, !compare)
        return { error: result.error, sizes: result.files?.map(file => file.size), elapsedMs: performance.now() - started, progress: result.progress.at(-1)?.ratio }
      }, !!process.env.MEDIA_TEST_BASE_REF)
      expect(result.error).toBeUndefined()
      expect(result.sizes).toHaveLength(2)
      expect(result.progress).toBe(1)
      process.stdout.write(`${JSON.stringify({ case: 'large-mov', sourceBytes: bytes, outputBytes: result.sizes, elapsedMs: result.elapsedMs })}\n`)
      if (process.env.MEDIA_TEST_BASE_REF) {
        const baseline = await page.evaluate(async () => {
          const source = (document.querySelector('#file') as HTMLInputElement).files![0]!
          const worker = new Worker('/built/baseline.js', { type: 'module' })
          try {
            return await new Promise<{ error?: string, elapsedMs: number, sizes: number[] }>((resolve, reject) => {
              worker.onmessage = event => resolve(event.data)
              worker.onerror = event => reject(new Error(event.message))
              worker.postMessage(source)
            })
          }
          finally { worker.terminate() }
        })
        expect(baseline.error).toBeUndefined()
        process.stdout.write(`${JSON.stringify({ case: 'old-loop-comparison', baselineRef: process.env.MEDIA_TEST_BASE_REF, baselineMs: baseline.elapsedMs, sdkMs: result.elapsedMs, baselineBytes: baseline.sizes })}\n`)
      }
    }
    finally { await page.close() }
  }, 180_000)

  it('runs the Asset Service adapter through OPFS and returns readable completed files', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async () => {
        const result = await window.convertMedia(await (await fetch('/fixture/audio-32000.mov')).blob(), false, true)
        return { error: result.error, sizes: await Promise.all((result.files ?? []).map(async file => (await file.arrayBuffer()).byteLength)), progress: result.progress }
      })
      expect(result.error).toBeUndefined()
      expect(result.sizes).toHaveLength(2)
      expect(result.sizes.every(size => size > 0)).toBe(true)
      expect(result.progress.at(-1)?.ratio).toBe(1)
    }
    finally { await page.close() }
  }, 30_000)
  it.each(['audio-32000.mov', 'audio-44100.mov', 'audio-48000.mov', 'no-audio.mp4', 'mono.mov', 'surround.mov', 'rotated.mov', 'negative-aac.mp4', 'vfr.mp4', 'cfr60.mp4', 'cfr2997.mp4', 'sync.mov'])('converts %s and passes independent ffprobe validation', async (name) => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async (fixture) => {
        const result = await window.convertMedia(await (await fetch(`/fixture/${fixture}`)).blob())
        if (result.error)
          throw new Error(result.error)
        return { files: await Promise.all(result.files.map(async (file: Blob) => Array.from(new Uint8Array(await file.arrayBuffer())))), progress: result.progress }
      }, name)
      expect(result.progress.at(-1)?.ratio).toBe(1)
      expect(result.files).toHaveLength(2)
      for (const [index, bytes] of result.files.entries()) {
        const outputPath = resolve(directory, `${name}-${index}.mp4`)
        await writeFile(outputPath, Buffer.from(bytes))
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath], { maxBuffer: 4 * 1024 * 1024 }).toString())
        const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')
        const audio = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio')
        expect(video.codec_name).toBe('h264')
        expect(video.height).toBe(index === 0 ? 96 : 48)
        const sourceProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', resolve(directory, name)]).toString())
        const sourceStart = Math.max(0, Math.min(...sourceProbe.streams.map((stream: { start_time?: string }) => Number(stream.start_time ?? 0))))
        expect(Math.abs(Number(probe.format.duration) - (Number(sourceProbe.format.duration) - sourceStart)), JSON.stringify({ source: sourceProbe.format, output: probe.format })).toBeLessThan(0.25)
        if (name === 'no-audio.mp4' || name === 'vfr.mp4' || name.startsWith('cfr'))
          expect(audio).toBeUndefined()
        else
          expect(audio.codec_name).toBe('aac')
        if (name === 'vfr.mp4' || name.startsWith('cfr')) {
          const timestamps = (path: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'json', path]).toString()).packets.map((packet: { pts_time: string }) => Number(packet.pts_time)).sort((a: number, b: number) => a - b)
          expect(timestamps(outputPath)).toEqual(timestamps(resolve(directory, name)))
        }
        if (name === 'sync.mov') {
          const audioBytes = execFileSync('ffmpeg', ['-v', 'error', '-i', outputPath, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 })
          const videoBytes = execFileSync('ffmpeg', ['-v', 'error', '-i', outputPath, '-an', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 })
          const frameSize = video.width * video.height
          for (const second of [0, 1, 2]) {
            let audioOnset = -1
            let videoOnset = -1
            for (let sample = second * 48_000; sample < (second + 1) * 48_000; sample++) {
              if (Math.abs(audioBytes.readFloatLE(sample * 4)) > 0.1) {
                audioOnset = sample / 48_000
                break
              }
            }
            for (let frame = second * 25; frame < (second + 1) * 25; frame++) {
              if (videoBytes[frame * frameSize]! > 200) {
                videoOnset = frame / 25
                break
              }
            }
            expect(audioOnset).toBeGreaterThanOrEqual(second)
            expect(videoOnset).toBeGreaterThanOrEqual(second)
            expect(Math.abs(audioOnset - videoOnset)).toBeLessThanOrEqual(0.05)
          }
        }
      }
    }
    finally { await page.close() }
  }, 30_000)

  it('converts 10-bit HEVC SDR or reports the unavailable native decoder', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async () => {
        const result = await window.convertMedia(await (await fetch('/fixture/hevc-10bit.mp4')).blob())
        return { error: result.error, files: result.files?.length }
      })
      if (result.error)
        expect(result.error).toContain('undecodable_source_codec')
      else
        expect(result.files).toBe(2)
    }
    finally { await page.close() }
  }, 30_000)

  it('uses the official AAC extension when native encoding is unavailable', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async () => {
        const result = await window.convertMedia(await (await fetch('/fixture/audio-32000.mov')).blob(), true)
        return { error: result.error, files: result.files?.length }
      })
      expect(result.error).toBeUndefined()
      expect(result.files).toBe(2)
    }
    finally { await page.close() }
  }, 30_000)

  it('reports AAC extension load failure instead of dropping audio', async () => {
    const page = await browser.newPage()
    try {
      await page.route('**/*aac-encoder*', route => route.abort())
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async () => await window.convertMedia(await (await fetch('/fixture/audio-32000.mov')).blob(), true))
      expect(result.error).toBeTruthy()
      expect(result.files).toBeUndefined()
    }
    finally { await page.close() }
  }, 30_000)

  it.each(['audio-32000.mov', 'offset-aac.mp4'])('cancels an active OPFS conversion and removes its partial files (%s)', async (name) => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async (name) => {
        const result = await window.convertMedia(await (await fetch(`/fixture/${name}`)).blob(), false, true, true)
        const root = await navigator.storage.getDirectory()
        let directory: FileSystemDirectoryHandle
        try {
          directory = await (await (await root.getDirectoryHandle('video-editor-assets')).getDirectoryHandle('v1')).getDirectoryHandle('temp')
        }
        catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError')
            return { error: result.error, files: [] }
          throw error
        }
        const files: string[] = []
        const collect = async (dir: FileSystemDirectoryHandle) => {
          for await (const handle of dir.values()) {
            if (handle.kind === 'file')
              files.push(handle.name)
            else
              await collect(handle as FileSystemDirectoryHandle)
          }
        }
        await collect(directory)
        return { error: result.error, files }
      }, name)
      expect(result.error).toContain('cancelled')
      expect(result.files).toEqual([])
    }
    finally { await page.close() }
  }, 30_000)

  it.each(['hdr.mp4', 'corrupt', 'offset.mov', 'offset-aac.mp4'])('rejects %s without returning partial output', async (name) => {
    const page = await browser.newPage()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.convertMedia)
      const result = await page.evaluate(async (fixture) => {
        const source = fixture === 'corrupt' ? new Blob(['invalid']) : await (await fetch(`/fixture/${fixture}`)).blob()
        return await window.convertMedia(source)
      }, name)
      expect(result.error).toBeTruthy()
      expect(result.files).toBeUndefined()
    }
    finally { await page.close() }
  })
})
