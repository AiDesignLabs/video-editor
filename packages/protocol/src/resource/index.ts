import { dir as _dir, file as _file, write as _write } from 'opfs-tools'
import { fileTo, getResourceType } from './fetch'

const ROOT_DIR = '/video-editor-res'

export function createResourceManager(opts?: { dir?: string }) {
  const { dir = ROOT_DIR } = opts || {}

  async function add(url: string) {
    if (await exists(url))
      return

    const body = (await fetch(url)).body
    if (!body)
      throw new Error('Resource not found')

    await _write(`${dir}/${url}`, body, { overwrite: true })
  }

  function exists(url: string) {
    if (!url)
      return

    const file = _file(`${dir}/${url}`)

    return file.exists()
  }

  async function get(url: string) {
    if (!(await exists(url)))
      return

    const { type } = await getResourceType(url)

    const file = _file(`${dir}/${url}`)
    return fileTo(type)(file)
  }

  async function remove(url: string) {
    if (!url)
      return

    const file = _file(`${dir}/${url}`)
    if (!file.exists())
      return

    await file.remove()
  }

  async function clear() {
    if (!(await _dir(dir).exists()))
      return

    await _dir(dir).remove()
  }

  return {
    add,
    get,
    remove,
    clear,
  }
}
