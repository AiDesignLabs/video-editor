export type PlaygroundRoute = 'editor' | 'transcode' | 'shaders'

export function resolvePlaygroundRoute(pathname = window.location.pathname): PlaygroundRoute {
  if (pathname === '/labs/transcode')
    return 'transcode'
  if (pathname === '/labs/shaders')
    return 'shaders'
  return 'editor'
}

export function navigatePlayground(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Keep the old query URL usable while making the canonical URL path-based. */
export function migrateLegacyLabUrl() {
  if (new URLSearchParams(window.location.search).get('lab') !== 'transcode')
    return
  window.history.replaceState({}, '', '/labs/transcode')
}
