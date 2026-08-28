import type { IVideoProtocol } from '@video-editor/shared'
import { dir as opfsDir, write as opfsWrite } from 'opfs-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectStore } from './index'

const projectDir = '/video-editor-projects-test'

function createProtocol(id = 'protocol-1'): IVideoProtocol {
  return {
    id,
    version: '1.0.0',
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [],
    transitions: [],
  }
}

describe('project store', () => {
  afterEach(async () => {
    const directory = opfsDir(projectDir)
    if (await directory.exists())
      await directory.remove()
  })

  it('roundtrips a project through save, list and load', async () => {
    const store = createProjectStore({ dir: projectDir })
    await store.saveProject({ id: 'p1', name: 'First cut', protocol: createProtocol() })

    const list = await store.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe('p1')
    expect(list[0]?.name).toBe('First cut')
    expect(typeof list[0]?.updatedAt).toBe('number')

    const loaded = await store.loadProject('p1')
    expect(loaded?.id).toBe('p1')
    expect(loaded?.name).toBe('First cut')
    expect(loaded?.protocol.width).toBe(1920)
    expect(loaded?.protocol.tracks).toEqual([])
  })

  it('returns undefined for an unknown project', async () => {
    const store = createProjectStore({ dir: projectDir })
    expect(await store.loadProject('missing')).toBeUndefined()
    expect(await store.listProjects()).toEqual([])
  })

  it('bumps updatedAt on save and lists the newest project first', async () => {
    const store = createProjectStore({ dir: projectDir })
    await store.saveProject({ id: 'p1', name: 'One', protocol: createProtocol() })
    const firstSave = (await store.loadProject('p1'))!.updatedAt

    await store.saveProject({ id: 'p2', name: 'Two', protocol: createProtocol('protocol-2') })
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.saveProject({ id: 'p1', name: 'One renamed', protocol: createProtocol() })

    const updated = await store.loadProject('p1')
    expect(updated?.name).toBe('One renamed')
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(firstSave)

    const list = await store.listProjects()
    expect(list.map(meta => meta.id)).toEqual(['p1', 'p2'])
  })

  it('deletes a project', async () => {
    const store = createProjectStore({ dir: projectDir })
    await store.saveProject({ id: 'p1', name: 'One', protocol: createProtocol() })
    await store.deleteProject('p1')

    expect(await store.loadProject('p1')).toBeUndefined()
    expect(await store.listProjects()).toEqual([])
    // Deleting twice is a no-op.
    await expect(store.deleteProject('p1')).resolves.toBeUndefined()
  })

  it('skips corrupt files when listing and returns undefined when loading them', async () => {
    const store = createProjectStore({ dir: projectDir })
    await store.saveProject({ id: 'p1', name: 'One', protocol: createProtocol() })
    await opfsWrite(`${projectDir}/broken.json`, '{ not json', { overwrite: true })
    await opfsWrite(`${projectDir}/p1.json.partial-abc`, '{}', { overwrite: true })

    const list = await store.listProjects()
    expect(list.map(meta => meta.id)).toEqual(['p1'])
    expect(await store.loadProject('broken')).toBeUndefined()
  })

  it('throws when a stored protocol fails validation', async () => {
    const store = createProjectStore({ dir: projectDir })
    const invalid = { id: 'bad', name: 'Bad', updatedAt: Date.now(), protocol: { version: '1.0.0' } }
    await opfsWrite(`${projectDir}/bad.json`, JSON.stringify(invalid), { overwrite: true })

    await expect(store.loadProject('bad')).rejects.toThrow(/invalid protocol/)
  })

  it('rejects ids that would escape the project directory', async () => {
    const store = createProjectStore({ dir: projectDir })
    await expect(store.loadProject('../escape')).rejects.toThrow(/invalid project id/)
  })
})
