import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./cache', () => ({
  getCachedResourceFile: async () => undefined,
}))

const { clearWaveformCache, extractWaveform } = await import('./waveform')

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function fakeAudioBuffer() {
  return {
    duration: 1,
    length: 4,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([0, 0.5, -1, 0.25]),
  } as unknown as AudioBuffer
}

beforeEach(() => {
  clearWaveformCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('waveform analysis scheduling', () => {
  it('shares equal waveform requests', async () => {
    const decoded = deferred<AudioBuffer>()
    const decodeAudioData = vi.fn(async () => await decoded.promise)
    const close = vi.fn(async () => {})
    vi.stubGlobal('AudioContext', class {
      decodeAudioData = decodeAudioData
      close = close
    })
    const fetchMock = vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }))
    vi.stubGlobal('fetch', fetchMock)

    const first = extractWaveform('https://example.com/shared.mp3', { samples: 2 })
    const second = extractWaveform('https://example.com/shared.mp3', { samples: 2 })
    await Promise.resolve()
    decoded.resolve(fakeAudioBuffer())

    await expect(Promise.all([first, second])).resolves.toEqual([
      { duration: 1, peaks: [0.5, 1] },
      { duration: 1, peaks: [0.5, 1] },
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(decodeAudioData).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('passes cancellation to the waveform fetch', async () => {
    const started = deferred<void>()
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new DOMException('cancelled', 'AbortError'))
        return
      }
      started.resolve()
      options?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const waveform = extractWaveform('https://example.com/cancelled.mp3', { signal: controller.signal })

    await started.promise
    controller.abort()
    await expect(waveform).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
