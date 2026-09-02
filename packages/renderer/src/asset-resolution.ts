import type { IVideoProtocol } from '@video-editor/shared'
import { cloneProtocol } from './helpers'

export type AssetUrlResolver = (
  assetId: string,
  fallbackUrl: string,
) => string | undefined | Promise<string | undefined>

/** Resolve stable asset ids on a detached protocol; the caller's protocol stays untouched. */
export async function resolveProtocolAssetUrls(
  protocol: IVideoProtocol,
  resolver?: AssetUrlResolver,
): Promise<IVideoProtocol> {
  const resolved = cloneProtocol(protocol)
  if (!resolver)
    return resolved

  await Promise.all(resolved.tracks.flatMap(track => track.children.map(async (segment) => {
    if (!('assetId' in segment) || !segment.assetId || !segment.url)
      return
    const url = await resolver(segment.assetId, segment.url)
    if (url === '')
      throw new Error(`Asset URL resolver returned an empty URL for asset ${segment.assetId}`)
    if (url !== undefined)
      segment.url = url
  })))

  return resolved
}
