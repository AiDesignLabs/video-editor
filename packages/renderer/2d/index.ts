import type { ApplicationOptions } from 'pixi.js'
import { Application } from 'pixi.js'

export async function createApp(opts?: Partial<ApplicationOptions>) {
  const app = new Application()

  await app.init({ resizeTo: window, ...opts })

  return app
}
