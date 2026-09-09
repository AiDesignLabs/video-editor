import type { AssetFileStore } from '../storage/asset-file-store'
import type { AssetDownloadCheckpoint } from '../storage/database'

export class AssetDownloadHttpError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`Asset download failed (${status} ${statusText}).`)
  }
}

export interface ResumableDownloadOptions {
  url: string
  outputPath: string
  chunkDirectory: string
  chunkSize: number
  checkpoint?: AssetDownloadCheckpoint
  files: AssetFileStore
  fetch: typeof fetch
  save: (checkpoint: AssetDownloadCheckpoint | undefined) => Promise<void>
  assertOwnership: () => Promise<void>
}

/** Each closed chunk is durable; failed requests lose at most one chunk. */
export async function downloadResumable(options: ResumableDownloadOptions): Promise<number> {
  let checkpoint = options.checkpoint
  let restarted = false
  const { files } = options
  const save = async (next: AssetDownloadCheckpoint | undefined) => {
    await options.save(next)
    checkpoint = next
  }
  const reset = async () => {
    const previous = checkpoint
    await save(undefined)
    for (const chunk of previous?.chunks ?? [])
      await files.remove(chunk.path)
    if (previous?.pendingPath)
      await files.remove(previous.pendingPath)
  }
  if (checkpoint?.pendingPath) {
    await options.assertOwnership()
    await files.remove(checkpoint.pendingPath)
    await save({ ...checkpoint, pendingPath: undefined })
  }
  if (checkpoint) {
    let size = 0
    let valid = Boolean(checkpoint.etag || checkpoint.lastModified)
    for (const chunk of checkpoint.chunks) {
      const file = await files.read(chunk.path, 'chunk')
      valid &&= file?.size === chunk.size
      size += chunk.size
    }
    valid &&= size === checkpoint.downloadedBytes && size <= checkpoint.totalBytes
    if (!valid)
      await reset()
  }

  async function writeWhole(response: Response) {
    if (response.status !== 200 || !response.body)
      throw new AssetDownloadHttpError(response.status, response.statusText)
    await reset()
    await options.assertOwnership()
    const size = Number(response.headers.get('content-length'))
    return await files.writeTemporary(options.outputPath, response.body, response.headers.has('content-length') && Number.isSafeInteger(size) && size >= 0 ? size : undefined)
  }

  while (true) {
    if (checkpoint && checkpoint.downloadedBytes === checkpoint.totalBytes)
      break
    await options.assertOwnership()
    const offset = checkpoint?.downloadedBytes ?? 0
    const end = Math.min(offset + options.chunkSize - 1, (checkpoint?.totalBytes ?? Infinity) - 1)
    const headers = new Headers({ Range: `bytes=${offset}-${end}` })
    const validator = checkpoint?.etag ?? checkpoint?.lastModified
    if (validator)
      headers.set('If-Range', validator)
    const response = await options.fetch(options.url, { headers })
    if (response.status === 200)
      return await writeWhole(response)
    if (response.status === 416 && checkpoint && !restarted) {
      await response.body?.cancel()
      await reset()
      restarted = true
      continue
    }
    if (response.status !== 206 || !response.body)
      throw new AssetDownloadHttpError(response.status, response.statusText)

    const rangeHeader = response.headers.get('content-range')
    const etag = response.headers.get('etag')
    const strongEtag = etag && !etag.startsWith('W/') ? etag : undefined
    const modified = response.headers.get('last-modified')
    const responseDate = response.headers.get('date')
    const lastModified = modified && responseDate && Date.parse(responseDate) - Date.parse(modified) >= 60_000 ? modified : undefined
    // Some servers do not expose range/validator headers to browser JS. Use an honest full download.
    if (!rangeHeader || (!strongEtag && !lastModified)) {
      await response.body.cancel()
      await options.assertOwnership()
      return await writeWhole(await options.fetch(options.url))
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(rangeHeader)
    const [start, last, total] = match ? match.slice(1).map(Number) : [NaN, NaN, NaN]
    if (![start, last, total].every(Number.isSafeInteger) || start !== offset || last! < start! || last! > end || total! <= last!) {
      await response.body.cancel()
      throw new Error(`Invalid Content-Range for asset download: ${rangeHeader}`)
    }
    if (checkpoint && (total !== checkpoint.totalBytes
      || (checkpoint.etag ? strongEtag !== checkpoint.etag : lastModified !== checkpoint.lastModified))) {
      await response.body.cancel()
      if (restarted)
        throw new Error('Asset changed repeatedly while resuming its download.')
      await reset()
      restarted = true
      continue
    }
    const path = `${options.chunkDirectory}/${crypto.randomUUID()}.partial`
    const current: AssetDownloadCheckpoint = checkpoint ?? {
      totalBytes: total!,
      downloadedBytes: 0,
      etag: strongEtag,
      lastModified,
      chunks: [],
    }
    try {
      await save({ ...current, pendingPath: path })
      const size = await files.writeTemporary(path, response.body, last! - start! + 1)
      await save({ ...current, pendingPath: undefined, downloadedBytes: offset + size, chunks: [...current.chunks, { path, size }] })
    }
    catch (error) {
      await response.body.cancel().catch(() => {})
      await files.remove(path).catch(() => {})
      throw error
    }
  }

  const completed = checkpoint
  if (!completed)
    throw new Error('Asset download completed without a checkpoint.')
  let index = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await options.assertOwnership()
        while (true) {
          if (!reader) {
            const chunk = completed.chunks[index++]
            if (!chunk) {
              controller.close()
              return
            }
            const file = await files.read(chunk.path, 'chunk')
            if (!file || file.size !== chunk.size)
              throw new Error('A persisted asset download chunk is missing or incomplete.')
            reader = file.stream().getReader()
          }
          const result = await reader.read()
          if (result.done) {
            reader.releaseLock()
            reader = undefined
            continue
          }
          controller.enqueue(result.value)
          return
        }
      }
      catch (error) {
        await reader?.cancel().catch(() => {})
        controller.error(error)
      }
    },
    async cancel() {
      await reader?.cancel()
    },
  })
  return await files.writeTemporary(options.outputPath, body as ReadableStream<BufferSource>, completed.totalBytes)
}
