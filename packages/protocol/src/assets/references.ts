import type { IVideoProtocol, SegmentUnion } from '@video-editor/shared'

export interface AssetReferenceTarget {
  id: string
  url: string
  previousUrls?: string[]
}

export interface AssetReference {
  protocolId: string
  trackId: string
  segmentId: string
}

export function findAssetReferences(protocol: IVideoProtocol, asset: AssetReferenceTarget): AssetReference[] {
  const references: AssetReference[] = []
  const knownUrls = new Set([asset.url, ...(asset.previousUrls ?? [])])
  for (const track of protocol.tracks) {
    for (const segment of track.children) {
      if (!('url' in segment))
        continue
      const media = segment as SegmentUnion & { assetId?: string, url: string }
      if (media.assetId !== asset.id && (media.assetId !== undefined || !knownUrls.has(media.url)))
        continue
      references.push({ protocolId: protocol.id, trackId: track.trackId, segmentId: segment.id })
    }
  }
  return references
}
