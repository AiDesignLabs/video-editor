/// <reference types="vite/client" />
import type { ApplicationOptions } from 'pixi.js'
import { Application } from 'pixi.js'

declare global {

  // eslint-disable-next-line vars-on-top
  var __PIXI_APP__: Application
}

export async function createApp(opts?: Partial<ApplicationOptions>) {
  const app = new Application()

  await app.init({
    // Custom effect/palette shaders ship GLSL only; on a WebGPU renderer the
    // whole filter chain of a display would be silently skipped.
    preference: 'webgl',
    resizeTo: window,
    backgroundAlpha: 0,
    resolution: globalThis.devicePixelRatio || 1,
    autoDensity: true,
    ...opts,
  })

  if (import.meta.env.DEV) {
    globalThis.__PIXI_APP__ = app
  }

  return app
}
