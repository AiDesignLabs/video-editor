import type { file as OPFSFile } from 'opfs-tools'

export type OPFSToolFile = ReturnType<typeof OPFSFile>

interface IResTypeMap {
  image: HTMLImageElement
  video: 'video'
  audio: 'audio'
  font: 'font'
  model: 'model'
}

type IResType = keyof IResTypeMap
const RES_TYPES: IResType[] = ['image', 'video', 'audio', 'font', 'model']

export function vFetch(url: string, init?: RequestInit) {
  const _url = new URL(url)

  return fetch(_url, init)
}

export async function getResourceType(url: string) {
  const res = await vFetch(url, { method: 'HEAD' })
  if (res.status !== 200)
    throw new Error('Resource not found')

  const type = res.headers.get('content-type')
  const totalSize = res.headers.get('content-length') ?? 0

  if (!type)
    throw new Error('Resource type not found')

  if (!RES_TYPES.some(key => type?.startsWith(key)))
    throw new Error('Resource type not support')

  return {
    type: type?.split('/')[0] as IResType,
    totalSize: +totalSize,
  }
}

export function fileTo(type: IResType) {
  return {
    image: fileToImage,
    video: () => Promise.resolve(),
    audio: () => Promise.resolve(),
    font: () => Promise.resolve(),
    model: () => Promise.resolve(),
  }[type]
}

async function fileToImage(file: OPFSToolFile) {
  const img = new Image()
  const originFile = await file.getOriginFile()
  if (!originFile)
    return

  img.src = URL.createObjectURL(originFile)
  return img
}
