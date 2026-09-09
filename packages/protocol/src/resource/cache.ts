import type { OTFile } from 'opfs-tools'
import type { CachedResourceFile } from './adapter'
import { file as opfsFile, write as opfsWrite } from 'opfs-tools'
import { getResourceCacheAdapter } from './adapter'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { getResourceOpfsPath } from './key'

interface CacheResourceOptions {
  body?: ReadableStream<BufferSource>
}

const inflightWritesByPath = new Map<string, Promise<void>>()

export async function getCachedResourceFile(url: string, resourceDir: string, options?: { waitForWrite?: boolean }): Promise<CachedResourceFile | undefined> {
  const adapter = /^https?:\/\//i.test(url) && getResourceCacheAdapter()
  if (adapter)
    return await adapter.get(url)
  const path = getResourceOpfsPath(resourceDir, url)
  if (!path)
    return undefined

  if (options?.waitForWrite !== false)
    await waitForResourceWrite(path)
  return await getExistingFile(path) ?? await getLegacyLocalFile(url, resourceDir)
}

export async function ensureResourceCached(
  url: string,
  resourceDir: string,
  options?: CacheResourceOptions,
): Promise<CachedResourceFile | undefined> {
  const adapter = /^https?:\/\//i.test(url) && getResourceCacheAdapter()
  if (adapter) {
    cancelBody(options?.body)
    await adapter.ensure(url)
    return undefined
  }
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    cancelBody(options?.body)
    return undefined
  }

  const path = getResourceOpfsPath(resourceDir, url)
  if (!path) {
    cancelBody(options?.body)
    return undefined
  }

  const activeWrite = inflightWritesByPath.get(path)
  if (activeWrite) {
    cancelBody(options?.body)
    await activeWrite
    return await getExistingFile(path)
  }

  const temporaryPath = createTemporaryPath(path)
  // Claim the path before the first asynchronous filesystem lookup yields.
  const job = writeResourceIfMissing(url, path, temporaryPath, resourceDir, options?.body)
  inflightWritesByPath.set(path, job)

  try {
    await job
  }
  finally {
    inflightWritesByPath.delete(path)
  }

  return await getExistingFile(path)
}

export async function waitForResourceWrite(path: string): Promise<void> {
  const activeWrite = inflightWritesByPath.get(path)
  if (!activeWrite)
    return

  try {
    await activeWrite
  }
  catch {
    // Readers can fall back to the network after a coordinated write failure.
  }
}

export async function waitForResourceDirectoryWrites(resourceDir: string): Promise<void> {
  const pathPrefix = resourceDir.endsWith('/') ? resourceDir : `${resourceDir}/`
  const activeWrites = [...inflightWritesByPath.entries()]
    .filter(([path]) => path.startsWith(pathPrefix))
    .map(([, job]) => job.catch(() => {}))
  await Promise.all(activeWrites)
}

async function writeResourceIfMissing(
  url: string,
  path: string,
  temporaryPath: string,
  resourceDir: string,
  providedBody?: ReadableStream<BufferSource>,
) {
  const existing = await getExistingFile(path) ?? await getLegacyLocalFile(url, resourceDir)
  if (existing) {
    cancelBody(providedBody)
    return
  }

  await writeResource(url, path, temporaryPath, providedBody)
}

async function writeResource(
  url: string,
  path: string,
  temporaryPath: string,
  providedBody?: ReadableStream<BufferSource>,
) {
  const temporaryFile = opfsFile(temporaryPath)
  const targetFile = opfsFile(path)

  try {
    if (await temporaryFile.exists())
      await temporaryFile.remove()

    const body = providedBody ?? (await fetch(url)).body
    if (!body)
      throw new Error('Resource not found')

    await opfsWrite(temporaryPath, body, { overwrite: true })
    await temporaryFile.moveTo(targetFile)
  }
  catch (error) {
    await removeFileIfExists(temporaryFile)
    await removeFileIfExists(targetFile)
    throw error
  }
}

async function getExistingFile(path: string): Promise<OTFile | undefined> {
  try {
    const file = opfsFile(path, 'r')
    if (await file.exists())
      return file
  }
  catch {
    return undefined
  }
  return undefined
}

async function getLegacyLocalFile(url: string, resourceDir: string) {
  // Keep existing local imports readable. Remote migration belongs to Asset Service.
  if (resourceDir !== DEFAULT_RESOURCE_DIR || !url.startsWith('local-asset://'))
    return undefined
  return await getExistingFile(getResourceOpfsPath('/video-editor-res', url))
}

async function removeFileIfExists(file: OTFile) {
  try {
    if (await file.exists())
      await file.remove()
  }
  catch {
    // Cleanup must not replace the original write error.
  }
}

function createTemporaryPath(path: string) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${path}.partial-${suffix}`
}

function cancelBody(body?: ReadableStream<BufferSource>) {
  void body?.cancel().catch(() => {})
}
