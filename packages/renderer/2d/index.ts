import type { ApplicationOptions } from 'pixi.js'
import { Application } from 'pixi.js'

declare global {

  // eslint-disable-next-line vars-on-top
  var __PIXI_APP__: Application
}

export async function createApp(opts?: Partial<ApplicationOptions>) {
  const app = new Application()

  await app.init({ resizeTo: window, ...opts })

  if (import.meta.env.DEV) {
    globalThis.__PIXI_APP__ = app
  }

  return app
}
