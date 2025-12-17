export type ResourceType = 'image' | 'video' | 'audio' | 'font' | 'model'

export function stripQueryAndHash(url: string) {
  if (!url)
    return ''
  const queryIndex = url.indexOf('?')
  const hashIndex = url.indexOf('#')
  const cutIndex = [queryIndex, hashIndex].filter(i => i >= 0).sort((a, b) => a - b)[0]
  return cutIndex === undefined ? url : url.slice(0, cutIndex)
}

function encodePathSegments(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map(seg => encodeURIComponent(seg))
    .join('/')
}

/**
 * Convert a user-provided URL into a stable, OPFS-safe key.
 * - Removes query/hash so signed URLs map to a single cached entry.
 * - Avoids `://` and other path-unfriendly sequences by encoding segments.
 */
export function getResourceKey(url: string) {
  const raw = stripQueryAndHash(url)
  if (!raw)
    return ''

  // Absolute URL: use protocol/host/path as a directory-style key.
  try {
    const u = new URL(raw)
    const protocol = u.protocol.replace(':', '') || 'unknown'
    const host = encodeURIComponent(u.host || 'unknown')
    const pathname = encodePathSegments(u.pathname || '/')
    return `${protocol}/${host}/${pathname}`
  }
  catch {
    // Relative or non-standard URL: store under a namespaced path.
    const cleaned = raw.replace(/^\.\/+/, '').replace(/^\/+/, '')
    return `relative/${encodePathSegments(cleaned)}`
  }
}

export function getResourceOpfsPath(resourceDir: string, url: string) {
  const key = getResourceKey(url)
  if (!key)
    return ''
  return `${resourceDir}/${key}`
}

export function inferResourceTypeFromUrl(url: string): ResourceType | undefined {
  const raw = stripQueryAndHash(url).toLowerCase()
  if (!raw)
    return undefined

  const path = (() => {
    try {
      return new URL(raw).pathname
    }
    catch {
      return raw
    }
  })()

  const filename = path.split('/').filter(Boolean).at(-1) ?? ''
  const ext = filename.includes('.') ? filename.split('.').at(-1) ?? '' : ''
  if (!ext)
    return undefined

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext))
    return 'image'
  if (['mp4', 'm4v', 'mov', 'webm'].includes(ext))
    return 'video'
  if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(ext))
    return 'audio'
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext))
    return 'font'
  if (['gltf', 'glb', 'obj', 'fbx'].includes(ext))
    return 'model'

  return undefined
}

