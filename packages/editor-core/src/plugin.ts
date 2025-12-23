import type { EditorCoreContext, EditorCorePlugin, EditorCorePluginCreator, EditorCorePluginManager } from './types'

export function createPluginManager(ctx: EditorCoreContext): EditorCorePluginManager {
  const plugins: EditorCorePlugin[] = []
  const pluginsMap = new Map<string, EditorCorePlugin>()
  let initialized = false

  const register = async (pluginCreator: EditorCorePluginCreator, options?: { autoInit?: boolean; override?: boolean }) => {
    const plugin = pluginCreator(ctx)
    const { name: pluginName } = plugin

    if (pluginsMap.has(pluginName)) {
      if (!options?.override) {
        throw new Error(`Plugin ${pluginName} has been registered`)
      }
      const existing = pluginsMap.get(pluginName)
      await existing?.destroy?.()
      const idx = plugins.findIndex(item => item.name === pluginName)
      if (idx >= 0)
        plugins.splice(idx, 1)
      pluginsMap.delete(pluginName)
    }

    plugins.push(plugin)
    pluginsMap.set(pluginName, plugin)

    if (options?.autoInit || initialized) {
      await plugin.init?.()
    }
  }

  const init = async () => {
    for (const plugin of plugins)
      await plugin.init?.()
    initialized = true
  }

  const get = (pluginName: string) => pluginsMap.get(pluginName)

  const has = (pluginName: string) => pluginsMap.has(pluginName)

  const remove = async (pluginName: string) => {
    const idx = plugins.findIndex(plugin => plugin.name === pluginName)
    if (idx === -1)
      return false
    const plugin = plugins[idx]
    await plugin.destroy?.()
    plugins.splice(idx, 1)
    return pluginsMap.delete(pluginName)
  }

  const destroy = async () => {
    for (const plugin of plugins)
      await plugin.destroy?.()
    plugins.length = 0
    pluginsMap.clear()
    initialized = false
  }

  return {
    register,
    init,
    get,
    has,
    remove,
    destroy,
  }
}
