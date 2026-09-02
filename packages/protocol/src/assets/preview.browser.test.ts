import { checkEncoderSupport, openMediaInput, renderCanvasToVideo } from '@video-editor/media'
import { dir as opfsDir } from 'opfs-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { createMediaAssetCatalog } from './catalog'

const resourceDir = '/video-editor-res/preview-generation-test'
const manifestDir = '/video-editor-assets-preview-generation-test'

function createCollectingSink() {
  const chunks: ArrayBuffer[] = []
  return {
    chunks,
    sink: new WritableStream<Uint8Array>({
      write(chunk) {
        const copy = new Uint8Array(chunk.byteLength)
        copy.set(chunk)
        chunks.push(copy.buffer)
      },
    }),
  }
}

async function createSourceVideo() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Preview generation test requires a 2D canvas context')

  const supportError = await checkEncoderSupport({
    format: 'mp4',
    width: canvas.width,
    height: canvas.height,
    withAudio: false,
  })
  expect(supportError).toBeNull()

  const output = createCollectingSink()
  const audio = new AudioBuffer({
    length: Math.round(0.4 * 48_000),
    numberOfChannels: 1,
    sampleRate: 48_000,
  })
  const channel = audio.getChannelData(0)
  for (let i = 0; i < channel.length; i++)
    channel[i] = Math.sin(2 * Math.PI * 440 * i / audio.sampleRate) * 0.2
  const result = await renderCanvasToVideo({
    canvas,
    durationMs: 400,
    fps: 5,
    sink: output.sink,
    audio,
    renderFrame({ frameIndex }) {
      context.fillStyle = frameIndex === 0 ? '#c9342f' : '#2474a8'
      context.fillRect(0, 0, canvas.width, canvas.height)
    },
  })
  return new File(output.chunks, 'source.mp4', { type: result.mimeType })
}

async function removeDir(path: string) {
  const directory = opfsDir(path)
  if (await directory.exists())
    await directory.remove()
}

describe('media asset preview generation', () => {
  afterEach(async () => {
    await removeDir(resourceDir)
    await removeDir(manifestDir)
  })

  it('generates an OPFS editing MP4 with audio for preview and export', async () => {
    const catalog = createMediaAssetCatalog({ resourceDir, manifestDir })
    const sourceFile = await createSourceVideo()
    const sourceInput = openMediaInput(sourceFile)
    await expect(sourceInput.meta()).resolves.toMatchObject({ hasAudio: true })
    sourceInput.dispose()
    const source = await catalog.import(sourceFile)
    const progress: number[] = []

    const updated = await catalog.generatePreviewVersion(source.id, {
      height: 32,
      videoBitrate: 200_000,
      keyFrameIntervalMs: 200,
      onProgress: state => progress.push(state.ratio),
    })

    expect(updated.proxyStatus).toBe('ready')
    expect(await catalog.list()).toHaveLength(1)
    expect(await catalog.resolveForPreview(source.id)).toBe(await catalog.resolveForExport(source.id))
    expect(progress.at(-1)).toBe(1)

    const previewFile = await catalog.getPreviewBlob(source.id)
    expect(previewFile).toBeDefined()
    const input = openMediaInput(previewFile!)
    try {
      await expect(input.meta()).resolves.toMatchObject({
        width: 32,
        height: 32,
        hasVideo: true,
        hasAudio: true,
      })
    }
    finally {
      input.dispose()
    }
  }, 20_000)
})
