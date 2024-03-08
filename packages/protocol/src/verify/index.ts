import type { IVideoProtocol } from '@video-editor/shared'

export function verify(o: Object, opt?: { ids?: Set<string> }): IVideoProtocol {
  const attr = ['width', 'height', 'fps', 'tracks']
  if (attr.some(k => k in o === false))
    throw new Error('invalid protocol', { cause: o })

  const ids: Set<string> = opt?.ids ?? new Set()

  return o as IVideoProtocol
}
