import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'

it.runIf(!!process.env.MEDIA_EXPERIMENT_REPORT && !!process.env.MEDIA_EXPERIMENT_SOURCE)('decodes every output frame and compares full-video visual quality', async () => {
  const reportPath = process.env.MEDIA_EXPERIMENT_REPORT!
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
    runs: Array<{ mode: string, outputs: Array<{ id: string, path: string, info: { streams: Array<{ codec_type: string, nb_read_packets: string, width: number, height: number }> } }> }>
    fullVideoQuality?: unknown
    fullResolutionVideoQuality?: unknown
  }
  const results = []
  for (const run of process.env.MEDIA_QUALITY_ALL_RUNS === '1' ? report.runs : report.runs.slice(0, 2)) {
    for (const output of run.outputs) {
      const video = output.info.streams.find(stream => stream.codec_type === 'video')!
      const resolution = process.env.MEDIA_QUALITY_FULL_RES === '1' ? `${video.width}:${video.height}` : '160:90'
      const stats = `ssim-${run.mode}-${output.id}-${resolution.replace(':', 'x')}.txt`
      process.stdout.write(`${JSON.stringify({ phase: 'full-video-quality', mode: run.mode, id: output.id })}\n`)
      execFileSync('ffmpeg', ['-v', 'error', '-i', process.env.MEDIA_EXPERIMENT_SOURCE!, '-i', output.path, '-filter_complex', `[0:v]scale=${resolution},setsar=1[reference];[1:v]scale=${resolution},setsar=1[candidate];[candidate][reference]ssim=stats_file=${stats}`, '-an', '-f', 'null', '-'], { cwd: dirname(reportPath), maxBuffer: 4 * 1024 * 1024 })
      const values = (await readFile(join(dirname(reportPath), stats), 'utf8')).trim().split('\n').map((line) => {
        const fields = Object.fromEntries(line.split(/\s+/).map(field => field.split(':')))
        return Number(fields.All)
      })
      expect(values.length).toBe(Number(output.info.streams.find(stream => stream.codec_type === 'video')!.nb_read_packets))
      expect(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
      const sorted = [...values].sort((a, b) => a - b)
      const result = { mode: run.mode, id: output.id, frames: values.length, meanSsim: values.reduce((sum, value) => sum + value, 0) / values.length, minimumSsim: sorted[0], firstPercentileSsim: sorted[Math.floor(sorted.length * 0.01)], analysisResolution: resolution.replace(':', 'x') }
      results.push(result)
      process.stdout.write(`${JSON.stringify(result)}\n`)
    }
  }
  if (process.env.MEDIA_QUALITY_FULL_RES === '1')
    report.fullResolutionVideoQuality = results
  else
    report.fullVideoQuality = results
  await writeFile(reportPath, JSON.stringify(report, null, 2))
}, 300_000)
