import { dir as _dir, file as _file, write as _write } from 'opfs-tools'

const ROOT_DIR = '/video-editor-res'

export function createResourceManager(opts?: { dir?: string }) {
  const { dir = ROOT_DIR } = opts || {}

  const add = async (url: string) => {
    if (!await _dir(dir).exists())
      await _dir(dir).create()

    const type = await getResType(url)

    if (type === 'image') {
      const body = (await fetch(url)).body
      if (!body)
        throw new Error('Resource not found')

      await _write(`${dir}/${url}`, body, { overwrite: true })
    }
  }

  const get = async (url: string) => {
    if (!url)
      return

    const file = _file(`${dir}/${url}`)

    if (!file.exists())
      return

    return file.path
  }

  const remove = async (url: string) => {
    if (!url)
      return

    const file = _file(`${dir}/${url}`)
    if (!file.exists())
      return

    await file.remove()
  }

  const clear = async () => {
    if (!await _dir(dir).exists())
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

const RES_TYPE_MAP = {
  image: HTMLImageElement,
  video: 'video',
  audio: 'audio',
  font: 'font',
  model: 'model',
} as const
type IResType = keyof typeof RES_TYPE_MAP

async function getResType(url: string): Promise<IResType> {
  const res = await fetch(url, { method: 'HEAD' })
  if (res.status !== 200)
    throw new Error('Resource not found')

  const type = res.headers.get('content-type')

  if (!type)
    throw new Error('Resource type not found')

  if (!Object.keys(RES_TYPE_MAP).some(key => type?.startsWith(key)))
    throw new Error('Resource type not found')

  return type?.split('/')[0] as IResType
}
