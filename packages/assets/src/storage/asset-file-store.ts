export interface AssetFileStore {
  read: (path: string, name: string, contentType?: string) => Promise<File | undefined>
  writeTemporary: (path: string, body: ReadableStream<BufferSource>, expectedSize?: number) => Promise<number>
  commitTemporary: (temporaryPath: string, targetPath: string) => Promise<void>
  write: (temporaryPath: string, targetPath: string, body: ReadableStream<BufferSource>, expectedSize?: number) => Promise<number>
  remove: (path: string) => Promise<void>
}

export function createAssetFileStore(): AssetFileStore {
  return {
    async read(path, name, contentType) {
      const handle = await getFileHandle(path, false)
      if (!handle)
        return undefined
      const originFile = await handle.getFile()
      return new File([originFile], name, { type: contentType ?? originFile.type, lastModified: originFile.lastModified })
    },
    async writeTemporary(path, body, expectedSize) {
      const temporary = await requireFileHandle(path, true)
      try {
        await writeStream(temporary, body)
        const written = await temporary.getFile()
        if (expectedSize !== undefined && written.size !== expectedSize)
          throw new Error(`Asset cache size mismatch: expected ${expectedSize}, received ${written.size}`)
        return written.size
      }
      catch (error) {
        await removePath(path).catch(() => {})
        throw error
      }
    },
    async commitTemporary(temporaryPath, targetPath) {
      const temporary = await requireFileHandle(temporaryPath, false)
      const written = await temporary.getFile()
      const target = await requireFileHandle(targetPath, true)
      await writeStream(target, written.stream() as ReadableStream<BufferSource>)
      await removePath(temporaryPath)
    },
    async write(temporaryPath, targetPath, body, expectedSize) {
      const size = await this.writeTemporary(temporaryPath, body, expectedSize)
      try {
        await this.commitTemporary(temporaryPath, targetPath)
        return size
      }
      catch (error) {
        await removePath(temporaryPath).catch(() => {})
        throw error
      }
    },
    remove: removePath,
  }
}

async function writeStream(handle: FileSystemFileHandle, stream: ReadableStream<BufferSource>) {
  const writable = await handle.createWritable()
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      await writable.write(value)
    }
    await writable.close()
  }
  catch (error) {
    await writable.abort(error).catch(() => {})
    throw error
  }
  finally {
    reader.releaseLock()
  }
}

async function rootDirectory() {
  if (!navigator.storage?.getDirectory)
    throw new Error('Origin Private File System is unavailable in this browser.')
  return await navigator.storage.getDirectory()
}

async function getFileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | undefined> {
  const parts = path.split('/').filter(Boolean)
  const fileName = parts.pop()
  if (!fileName)
    throw new TypeError(`Invalid OPFS file path: ${path}`)
  let directory = await rootDirectory()
  try {
    for (const part of parts)
      directory = await directory.getDirectoryHandle(part, { create })
    return await directory.getFileHandle(fileName, { create })
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError')
      return undefined
    throw error
  }
}

async function requireFileHandle(path: string, create: boolean) {
  const handle = await getFileHandle(path, create)
  if (!handle)
    throw new Error(`OPFS file is unavailable: ${path}`)
  return handle
}

async function removePath(path: string) {
  const parts = path.split('/').filter(Boolean)
  const fileName = parts.pop()
  if (!fileName)
    return
  let directory = await rootDirectory()
  try {
    for (const part of parts)
      directory = await directory.getDirectoryHandle(part)
    await directory.removeEntry(fileName)
  }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError'))
      throw error
  }
}
