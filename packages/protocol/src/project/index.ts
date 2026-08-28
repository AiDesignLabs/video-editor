import type { IVideoProtocol } from '@video-editor/shared'
import type { OTFile } from 'opfs-tools'
import { dir as opfsDir, file as opfsFile, write as opfsWrite } from 'opfs-tools'
import { createValidator } from '../verify'

export const DEFAULT_PROJECT_DIR = '/video-editor-projects'

export interface ProjectMeta {
  id: string
  name: string
  /** Epoch milliseconds of the last successful save. */
  updatedAt: number
}

export interface StoredProject extends ProjectMeta {
  protocol: IVideoProtocol
}

export interface ProjectStore {
  saveProject: (project: { id: string, name: string, protocol: IVideoProtocol }) => Promise<void>
  /** Most recently updated first. */
  listProjects: () => Promise<ProjectMeta[]>
  loadProject: (id: string) => Promise<StoredProject | undefined>
  deleteProject: (id: string) => Promise<void>
}

export interface ProjectStoreOptions {
  /** OPFS directory holding one `<id>.json` file per project. */
  dir?: string
}

const TEMPORARY_PREFIX = '.partial-'

/** Serializes writes per project path so concurrent saves never interleave. */
const writeQueues = new Map<string, Promise<unknown>>()

function enqueueWrite<T>(path: string, job: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(path) ?? Promise.resolve()
  const next = previous.then(job, job)
  // Keep the chain alive even when a job rejects.
  writeQueues.set(path, next.catch(() => {}))
  return next
}

function normalizeDir(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  return trimmed || '/'
}

function isValidProjectId(id: string) {
  // Ids become file names, so path separators must never slip through.
  return /^[\w.-]+$/.test(id) && id !== '.' && id !== '..' && !id.startsWith(TEMPORARY_PREFIX)
}

function assertProjectId(id: string) {
  if (!isValidProjectId(id))
    throw new Error(`createProjectStore: invalid project id "${id}"`)
}

function createTemporaryPath(path: string) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${path}${TEMPORARY_PREFIX}${suffix}`
}

async function removeFileIfExists(file: OTFile) {
  try {
    if (await file.exists())
      await file.remove()
  }
  catch {
    // Cleanup must not replace the original error.
  }
}

function isStoredProjectShape(value: unknown): value is StoredProject {
  if (!value || typeof value !== 'object')
    return false
  const project = value as Partial<StoredProject>
  return typeof project.id === 'string'
    && typeof project.name === 'string'
    && typeof project.updatedAt === 'number'
    && !!project.protocol
    && typeof project.protocol === 'object'
}

/**
 * Reads a project file. Returns `undefined` when the file is missing or its
 * JSON is unreadable; the protocol itself is not validated here.
 */
async function readStoredProject(path: string): Promise<StoredProject | undefined> {
  let text: string
  try {
    const handle = opfsFile(path, 'r')
    if (!(await handle.exists()))
      return undefined
    text = await handle.text()
  }
  catch {
    return undefined
  }

  if (!text)
    return undefined

  try {
    const parsed: unknown = JSON.parse(text)
    if (!isStoredProjectShape(parsed))
      return undefined
    return parsed
  }
  catch (error) {
    console.error('[project] skip unreadable project file', path, error)
    return undefined
  }
}

/**
 * One JSON file per project inside an OPFS directory. Saves are atomic
 * (temp file + move) and serialized per project.
 */
export function createProjectStore(options: ProjectStoreOptions = {}): ProjectStore {
  const projectDir = normalizeDir(options.dir ?? DEFAULT_PROJECT_DIR)
  const projectPath = (id: string) => `${projectDir}/${id}.json`

  const saveProject: ProjectStore['saveProject'] = async ({ id, name, protocol }) => {
    assertProjectId(id)
    const path = projectPath(id)

    await enqueueWrite(path, async () => {
      const stored: StoredProject = {
        id,
        name,
        updatedAt: Date.now(),
        protocol,
      }
      const payload = JSON.stringify(stored)

      await opfsDir(projectDir).create()

      const temporaryPath = createTemporaryPath(path)
      const temporaryFile = opfsFile(temporaryPath)
      const targetFile = opfsFile(path)
      try {
        if (await temporaryFile.exists())
          await temporaryFile.remove()

        await opfsWrite(temporaryPath, payload, { overwrite: true })
        // moveTo overwrites the target, so the previous version stays readable
        // until the new payload is fully written.
        await temporaryFile.moveTo(targetFile)
      }
      catch (error) {
        await removeFileIfExists(temporaryFile)
        throw error
      }
    })
  }

  const listProjects: ProjectStore['listProjects'] = async () => {
    const directory = opfsDir(projectDir)
    if (!(await directory.exists()))
      return []

    const children = await directory.children()
    const files = children.filter((child): child is OTFile =>
      child.kind === 'file'
      && child.name.endsWith('.json')
      && !child.name.includes(TEMPORARY_PREFIX))

    const metas = await Promise.all(files.map(async (child) => {
      const stored = await readStoredProject(child.path)
      if (!stored)
        return undefined
      return { id: stored.id, name: stored.name, updatedAt: stored.updatedAt } satisfies ProjectMeta
    }))

    return metas
      .filter((meta): meta is ProjectMeta => !!meta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  const loadProject: ProjectStore['loadProject'] = async (id) => {
    assertProjectId(id)
    const stored = await readStoredProject(projectPath(id))
    if (!stored)
      return undefined

    try {
      createValidator().verify(stored.protocol)
    }
    catch (error) {
      throw new Error(
        `createProjectStore: project "${id}" holds an invalid protocol: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    return stored
  }

  const deleteProject: ProjectStore['deleteProject'] = async (id) => {
    assertProjectId(id)
    const path = projectPath(id)
    await enqueueWrite(path, async () => {
      await removeFileIfExists(opfsFile(path))
    })
  }

  return { saveProject, listProjects, loadProject, deleteProject }
}
