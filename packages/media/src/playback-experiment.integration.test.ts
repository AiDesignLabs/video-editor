import type { ExperimentMode, ExperimentResult } from '../test/shared-decode-experiment'
import { execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { chromium } from 'playwright'
import { build, createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXPERIMENT_MODES } from '../test/shared-decode-experiment'

declare global {
  interface Window { mediaStudyResult?: ExperimentResult }
}

function probe(path: string, countPackets = false) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...(countPackets ? ['-count_packets'] : []), '-show_streams', '-show_format', '-of', 'json', path], { maxBuffer: 8 * 1024 * 1024 }).toString()) as {
    format: { duration: string, size: string }
    streams: Array<{ codec_type: string, codec_name: string, width?: number, height?: number, nb_frames?: string, nb_read_packets?: string, start_time?: string, duration?: string }>
  }
}

function audioWindow(path: string, at: number, duration = 2) {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', path, '-t', String(duration), '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 4 * 1024 * 1024 })
  return Array.from({ length: bytes.byteLength / 4 }, (_, index) => bytes.readFloatLE(index * 4))
}

function alignment(reference: number[], candidate: number[]) {
  let best = { lagMs: 0, correlation: -1 }
  for (let lag = -1200; lag <= 1200; lag++) {
    let cross = 0
    let energyA = 0
    let energyB = 0
    const length = Math.min(reference.length, candidate.length) - 1200
    for (let index = 1200; index < length; index += 4) {
      const a = reference[index]!
      const b = candidate[index + lag]!
      cross += a * b
      energyA += a * a
      energyB += b * b
    }
    const correlation = cross / Math.sqrt(energyA * energyB)
    if (Number.isFinite(correlation) && correlation > best.correlation)
      best = { lagMs: lag / 8, correlation }
  }
  return best
}

function imageSimilarity(a: number[], b: number[]) {
  const mse = a.reduce((sum, value, index) => sum + (value - b[index]!) ** 2, 0) / a.length
  return mse === 0 ? 100 : 10 * Math.log10(255 ** 2 / mse)
}

function packetTimes(path: string) {
  const data = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'json', path], { maxBuffer: 8 * 1024 * 1024 }).toString()) as { packets: Array<{ pts_time: string, flags: string }> }
  return { timestamps: data.packets.map(packet => Number(packet.pts_time)).sort((a, b) => a - b), keyframes: data.packets.filter(packet => packet.flags.includes('K')).length }
}

function audibleEnd(samples: number[], start: number) {
  for (let index = samples.length - 1; index >= 0; index--) {
    if (Math.abs(samples[index]!) > 0.001)
      return start + index / 8000
  }
  return null
}

describe.runIf(!!process.env.MEDIA_EXPERIMENT_SOURCE)('isolated playback and shared-decode study', () => {
  let server: Awaited<ReturnType<typeof createServer>>
  let browser: Awaited<ReturnType<typeof chromium.launch>>
  let directory: string
  let origin: string
  const sourcePath = resolve(process.env.MEDIA_EXPERIMENT_SOURCE || 'source.mov')
  const mediaFiles = new Map<string, string>()

  beforeAll(async () => {
    await stat(sourcePath)
    directory = await mkdtemp(join(tmpdir(), 'video-playback-study-'))
    process.stdout.write(`${JSON.stringify({ studyDirectory: directory })}\n`)
    mediaFiles.set('source', sourcePath)
    const built = join(directory, 'build')
    await build({ configFile: false, root: resolve('.'), logLevel: 'error', base: '/built/', worker: { format: 'es' }, build: { outDir: built, target: 'esnext', minify: true, rollupOptions: { input: resolve('test/conversion-entry.ts'), output: { entryFileNames: 'entry.js' } } } })
    server = await createServer({ configFile: false, root: resolve('.'), cacheDir: join(directory, 'vite-cache'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'study-files', configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (url.pathname === '/') {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><title>Playback study</title><input id="file" type="file"><script type="module" src="/built/entry.js"></script>')
          return
        }
        if (url.pathname.startsWith('/upload/') && request.method === 'POST') {
          const key = url.pathname.slice('/upload/'.length)
          if (!/^[\w-]+$/.test(key)) {
            response.writeHead(400).end()
            return
          }
          const path = join(directory, `${key}.mp4`)
          void pipeline(request, createWriteStream(path)).then(() => {
            mediaFiles.set(key, path)
            response.writeHead(200).end()
          }).catch(() => response.writeHead(500).end())
          return
        }
        const builtPath = resolve(built, `.${url.pathname.slice('/built'.length)}`)
        const path = url.pathname.startsWith('/media/')
          ? mediaFiles.get(url.pathname.slice('/media/'.length))
          : url.pathname.startsWith('/built/') && builtPath.startsWith(`${built}/`) ? builtPath : undefined
        if (!path)
          return next()
        void stat(path).then(({ size }) => {
          response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : 'video/mp4')
          response.setHeader('Accept-Ranges', 'bytes')
          let start = 0
          let end = size - 1
          if (request.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
            if (!range || (!range[1] && !range[2])) {
              response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
              return
            }
            start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
            end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
            if (start > end) {
              response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
              return
            }
            response.statusCode = 206
            response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
          }
          response.setHeader('Content-Length', end - start + 1)
          const stream = createReadStream(path, { start, end })
          response.on('close', () => stream.destroy())
          stream.on('error', () => response.destroy()).pipe(response)
        }).catch(() => response.writeHead(404).end())
      })
    } }] })
    await server.listen()
    origin = server.resolvedUrls!.local[0]!
    browser = await chromium.launch({ channel: process.env.MEDIA_TEST_BROWSER || 'chrome', headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
    // Keep the measured media and report for independent inspection after this run.
  })

  it('measures the same long file in ABBA order with identical rendition settings', async () => {
    const sourceInfo = probe(sourcePath)
    const sourceVideo = sourceInfo.streams.find(stream => stream.codec_type === 'video')!
    const duration = Number(sourceInfo.format.duration)
    const times = [0, duration / 2, duration - 3]
    const referenceAudio = times.map(at => audioWindow(sourcePath, at))
    const sourcePackets = packetTimes(sourcePath)
    const sourceAudibleEnd = audibleEnd(audioWindow(sourcePath, duration - 4, 4.3), duration - 4)
    const reports: Array<Record<string, unknown>> = []
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const system = await browser.newBrowserCDPSession()
    try {
      await page.goto(origin)
      await page.waitForFunction(() => !!window.runMediaExperiment)
      await page.locator('#file').setInputFiles(sourcePath)
      const requestedModes = process.env.MEDIA_EXPERIMENT_MODES?.split(',')
      if (requestedModes?.some(mode => !EXPERIMENT_MODES.includes(mode as ExperimentMode)))
        throw new Error('Unknown experiment mode.')
      const order: ExperimentMode[] = requestedModes as ExperimentMode[] ?? (process.env.MEDIA_EXPERIMENT_ABLATION === '1' ? ['serial', 'shared', 'serial-process', 'shared-clone', 'shared-queued'] : ['serial', 'shared', 'shared', 'serial'])
      for (const [index, mode] of order.entries()) {
        let polling: Promise<void> | undefined
        const rss: number[] = []
        const sampleMemory = async () => {
          const { processInfo } = await system.send('SystemInfo.getProcessInfo')
          const pids = processInfo.map(process => process.id).join(',')
          const values = execFileSync('ps', ['-o', 'rss=', '-p', pids]).toString().trim().split(/\s+/).map(Number)
          rss.push(values.reduce((sum, value) => sum + value * 1024, 0))
        }
        await sampleMemory()
        const timer = setInterval(() => {
          if (!polling)
            polling = sampleMemory().finally(() => { polling = undefined })
        }, 1000)
        process.stdout.write(`${JSON.stringify({ run: index, mode, phase: 'converting' })}\n`)
        const wallStartedAt = new Date().toISOString()
        let result: Omit<ExperimentResult, 'files'> & { sizes: Array<{ id: string, bytes: number }> }
        try {
          result = await page.evaluate(async (mode) => {
            const source = (document.querySelector('#file') as HTMLInputElement).files![0]!
            const result = await window.runMediaExperiment(source, mode)
            window.mediaStudyResult = result
            const { files, ...stats } = result
            return { ...stats, sizes: files.map(({ id, file }) => ({ id, bytes: file.size })) }
          }, mode)
        }
        finally {
          clearInterval(timer)
          await polling
        }
        const prefix = `${index}-${mode}`
        await page.evaluate(async (prefix) => {
          for (const { id, file } of window.mediaStudyResult!.files) {
            const response = await fetch(`/upload/${prefix}-${id}`, { method: 'POST', body: file })
            if (!response.ok)
              throw new Error('Could not save the experimental output.')
          }
        }, prefix)
        const outputs = []
        for (const id of ['proxy', 'preview']) {
          const path = mediaFiles.get(`${prefix}-${id}`)!
          const info = probe(path, true)
          const video = info.streams.find(stream => stream.codec_type === 'video')!
          expect(Number(video.nb_read_packets)).toBe(Number(sourceVideo.nb_frames))
          expect(video.height).toBe(id === 'proxy' ? 360 : 720)
          expect(info.streams.some(stream => stream.codec_name === 'aac')).toBe(true)
          const audioAlignment = times.map((at, sample) => ({ at, ...alignment(referenceAudio[sample]!, audioWindow(path, at)) }))
          const packets = packetTimes(path)
          expect(packets.timestamps.length).toBe(sourcePackets.timestamps.length)
          const maxVideoTimestampDeltaMs = packets.timestamps.reduce((max, timestamp, sample) => Math.max(max, Math.abs(timestamp - sourcePackets.timestamps[sample]!) * 1000), 0)
          expect(maxVideoTimestampDeltaMs).toBeLessThan(0.01)
          const lastAudibleSec = audibleEnd(audioWindow(path, duration - 4, 4.3), duration - 4)
          outputs.push({ id, path, info, audioAlignment, keyframes: packets.keyframes, maxVideoTimestampDeltaMs, lastAudibleSec, wouldCutAudibleTailMs: lastAudibleSec === null ? null : Math.max(0, lastAudibleSec - duration) * 1000 })
        }
        const report = { ...result, wallStartedAt, rssBaselineBytes: rss[0], rssPeakBytes: Math.max(...rss), rssSamples: rss.length, outputs }
        reports.push(report)
        await writeFile(join(directory, 'runs.json'), JSON.stringify(reports, null, 2))
        process.stdout.write(`${JSON.stringify({ run: index, ...result, rssBaselineBytes: rss[0], rssPeakBytes: Math.max(...rss), outputs: outputs.map(({ id, audioAlignment }) => ({ id, audioAlignment })) })}\n`)
        await page.evaluate(async () => {
          const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('video-editor-experiments')
          await root.removeEntry(window.mediaStudyResult!.jobId, { recursive: true })
          delete window.mediaStudyResult
        })
      }

      const snapshots: Record<string, Array<{ time: number, nativeDuration: number, pixels: number[] }>> = {}
      for (const key of ['source', ...order.slice(0, 2).flatMap((mode, index) => [`${index}-${mode}-proxy`, `${index}-${mode}-preview`])]) {
        snapshots[key] = await page.evaluate(async ({ key, duration }) => {
          const video = document.createElement('video')
          video.muted = true
          video.preload = 'auto'
          document.body.append(video)
          const ready = new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve()
            video.onerror = () => reject(new Error('Playback failed'))
          })
          video.src = `/media/${key}`
          await ready
          const canvas = document.createElement('canvas')
          canvas.width = 64
          canvas.height = 36
          const context = canvas.getContext('2d')!
          const samples = []
          try {
            for (const time of [0.08, duration / 2, duration - 0.16]) {
              const seek = new Promise<void>(resolve => video.onseeked = () => resolve())
              video.currentTime = time
              await seek
              context.drawImage(video, 0, 0, 64, 36)
              samples.push({ time: video.currentTime, nativeDuration: video.duration, pixels: Array.from(context.getImageData(0, 0, 64, 36).data) })
            }
            return samples
          }
          finally {
            video.removeAttribute('src')
            video.load()
            video.remove()
          }
        }, { key, duration })
      }
      const frameSimilarity = Object.entries(snapshots).filter(([key]) => key !== 'source').map(([key, frames]) => ({ key, frames: frames.map((frame, index) => ({ time: frame.time, nativeDuration: frame.nativeDuration, psnrDb: imageSimilarity(snapshots.source![index]!.pixels, frame.pixels) })) }))
      const report = { source: { name: basename(sourcePath), ...sourceInfo, lastAudibleSec: sourceAudibleEnd }, browser: await browser.version(), order: [...order], memoryMetric: 'Sum of Chrome process RSS, sampled every second; shared pages may be counted more than once. Includes neither a dedicated GPU-memory measure nor exclusive worker heap.', runs: reports, frameSimilarity }
      await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2))
      process.stdout.write(`${JSON.stringify({ report: join(directory, 'report.json'), frameSimilarity })}\n`)
    }
    finally {
      await system.detach()
      await page.close()
    }
  }, 600_000)
})
