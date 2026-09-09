import type { IVideoProtocol } from '@video-editor/shared'
import { cloneProtocol } from './helpers'

export interface AssetUrlHandle {
  url: string
  source: 'opfs' | 'url'
  release: () => void
}

export type AssetUrlResolver = (
  assetId: string,
  fallbackUrl: string,
  context?: AssetResolutionContext,
) => string | AssetUrlHandle | undefined | Promise<string | AssetUrlHandle | undefined>

export interface AssetResolutionContext {
  media: 'visual' | 'audio'
}

/** Resolve stable asset ids on a detached protocol; the caller's protocol stays untouched. */
export async function resolveProtocolAssetUrls(
  protocol: IVideoProtocol,
  resolver?: AssetUrlResolver,
  context?: AssetResolutionContext,
  onHandle?: (handle: AssetUrlHandle) => void,
): Promise<IVideoProtocol> {
  const resolved = cloneProtocol(protocol)
  if (!resolver)
    return resolved

  await Promise.all(resolved.tracks.flatMap(track => track.children.map(async (segment) => {
    if (!('assetId' in segment) || !segment.assetId || !segment.url)
      return
    const result = await resolver(segment.assetId, segment.url, context)
    const url = typeof result === 'object' ? result.url : result
    if (typeof result === 'object')
      onHandle?.(result)
    if (url === '')
      throw new Error(`Asset URL resolver returned an empty URL for asset ${segment.assetId}`)
    if (url !== undefined)
      segment.url = url
  })))

  return resolved
}
