import type { IVideoProtocol } from '@video-editor/shared'

type parseFn = (videoProtocolStr: string) => Object

const parse: parseFn = (videoProtocolStr) => {
  if (typeof videoProtocolStr !== 'string')
    throw new TypeError('invalid protocol', { cause: videoProtocolStr })

  let o: Object
  // custom DSL need compile
  try {
    o = compile(videoProtocolStr)
  }
  catch (error) {
    throw new Error('invalid protocol', { cause: videoProtocolStr })
  }

  if (typeof o !== 'object' || Array.isArray(o) || o === null)
    throw new Error('invalid protocol', { cause: videoProtocolStr })

  return o as IVideoProtocol
}

function compile(videoProtocolStr: string) {
  return JSON.parse(videoProtocolStr)
}

export { parse }
