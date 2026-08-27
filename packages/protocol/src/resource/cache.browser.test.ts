import { dir as opfsDir, file as opfsFile } from 'opfs-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureResourceCached, getCachedResourceFile } from './cache'
import { getResourceOpfsPath } from './key'

const resourceDir = '/video-editor-res/shared-write-test'

describe('shared resource cache writes', () => {
  afterEach(async () => {
    const directory = opfsDir(resourceDir)
    if (await directory.exists())
      await directory.remove()
  })

  it('keeps the final path hidden and blocks readers until the write completes', async () => {
    const url = 'https://example.test/slow-video.mp4'
    const path = getResourceOpfsPath(resourceDir, url)
    let finishWrite: (() => void) | undefined
    const body = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first-'))
        finishWrite = () => {
          controller.enqueue(new TextEncoder().encode('second'))
          controller.close()
        }
      },
    })

    const writePromise = ensureResourceCached(url, resourceDir, { body })
    let readSettled = false
    const readPromise = getCachedResourceFile(url, resourceDir).finally(() => {
      readSettled = true
    })

    let finalPathWasVisible = true
    let readSettledBeforeFinish = true
    let cachedFile: Awaited<ReturnType<typeof getCachedResourceFile>>
    try {
      await new Promise(resolve => setTimeout(resolve, 50))
      finalPathWasVisible = await opfsFile(path, 'r').exists()
      readSettledBeforeFinish = readSettled
    }
    finally {
      finishWrite?.()
      await writePromise
      cachedFile = await readPromise
    }

    expect(finalPathWasVisible).toBe(false)
    expect(readSettledBeforeFinish).toBe(false)
    expect(await cachedFile?.text()).toBe('first-second')
  })
})
