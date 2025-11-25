import type { MP4ArrayBuffer, MP4File, MP4Info, MP4Sample } from '@webav/mp4box.js'
import type { file as OPFSFile } from 'opfs-tools'
import mp4box from '@webav/mp4box.js'

export type OPFSToolFile = ReturnType<typeof OPFSFile>

export interface ISamples {
  id: number
  type: 'video' | 'audio'
  samples: MP4Sample[]
}

interface IResTypeMap {
  image: HTMLImageElement
  video: ISamples[]
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

function fetchRange(url: string, start: number, end: number) {
  return vFetch(url, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
  })
}

export async function fileToMP4Samples(
  input: string | OPFSToolFile,
  cbs: {
    onReady?: (data: { info: MP4Info, mp4BoxFile: MP4File }) => void
    onSamples?: (data: ISamples) => void
    onDone?: () => void
    onError?: (err: Error) => void
  },
) {
  const mp4file = mp4box.createFile()

  let isReady = false

  const totalSize = typeof input === 'string'
    ? await (await getResourceType(input)).totalSize
    : await input.getSize()

  const reader = typeof input === 'string' ? null : await input.createReader()

  mp4file.onReady = (info) => {
    const vTrackId = info.videoTracks[0]?.id
    if (vTrackId != null)
      mp4file.setExtractionOptions(vTrackId, 'video', { nbSamples: 100 })

    const aTrackId = info.audioTracks[0]?.id
    if (aTrackId != null)
      mp4file.setExtractionOptions(aTrackId, 'audio', { nbSamples: 100 })

    mp4file.start()

    isReady = true
    cbs.onReady?.({ info, mp4BoxFile: mp4file })
  }

  mp4file.onError = (err) => {
    cbs.onError?.(new Error(err))
  }

  const releasedCnt: Record<number, number> = {}
  mp4file.onSamples = (id, type, samples) => {
    if (typeof cbs.onSamples !== 'function')
      return
    releasedCnt[id] = (releasedCnt[id] ?? 0) + samples.length
    mp4file.releaseUsedSamples(id, releasedCnt[id])
    cbs.onSamples?.({ id, type, samples: samples.map(s => ({ ...s })) })
  }

  mp4file.onFlush = () => {
    cbs.onDone?.()
    reader?.close()
  }

  async function read(data: string | OPFSToolFile): Promise<(start: number, end: number) => Promise<ArrayBuffer>> {
    if (typeof data === 'string') {
      return async (start: number, end: number) => {
        if (start >= totalSize)
          return new ArrayBuffer(0)

        const res = await fetchRange(data, start, Math.min(end, totalSize))
        return await res.arrayBuffer()
      }
    }

    return async (start: number, end: number) => {
      return await reader!.read(end - start, { at: start })
    }
  }

  const chunkSize = 1024 * 1024 * 1 // 1MB
  async function readChunk(start: number, end: number) {
    if (start >= end - 1)
      return

    if (!cbs.onSamples && isReady)
      return cbs.onDone?.()

    const data = await (await read(input))(start, end)
    const inputBuf = data as MP4ArrayBuffer
    inputBuf.fileStart = start
    const next = mp4file.appendBuffer(inputBuf)

    if (!next || next >= end - 1)
      return cbs.onDone?.()

    await readChunk(next, next + chunkSize)
  }

  await readChunk(0, chunkSize)

  return {
    stop: () => {
      mp4file.flush()
      mp4file.stop()
      mp4file.onFlush?.()
      reader?.close()
    },
  }
}

export function fileTo(type: IResType) {
  return {
    image: fileToImage,
    video: fileToMP4,
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

async function fileToMP4(file: OPFSToolFile) {
  return new Promise<ISamples[]>((resolve, reject) => {
    const samples: ISamples[] = []
    fileToMP4Samples(file, {
      onSamples: (data) => {
        samples.push(data)
      },
      onDone: () => {
        resolve(samples)
      },
      onError: (err) => {
        reject(err)
      },
    })
  })
}
