import type { ITrackType } from '@video-editor/shared'
import type { SegmentPlugin, SegmentRegistry } from './types'

export function createSegmentRegistry(): SegmentRegistry {
  const registry = new Map<ITrackType, SegmentPlugin>()

  const register = (plugin: SegmentPlugin, options?: { override?: boolean }) => {
    if (registry.has(plugin.type) && !options?.override) {
      throw new Error(`Segment plugin ${plugin.type} has been registered`)
    }
    registry.set(plugin.type, plugin)
  }

  const get = (type: ITrackType) => registry.get(type)

  const list = () => [...registry.values()]

  return {
    register,
    get,
    list,
  }
}
