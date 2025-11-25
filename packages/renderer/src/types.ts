import type { Ref } from '@vue/reactivity'
import type { Container } from 'pixi.js'

export type MaybeRef<T> = T | Ref<T>
export type PixiDisplayObject = Container['children'][number]
