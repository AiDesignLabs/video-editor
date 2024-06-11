import type { ComputedRef, Ref } from '@vue/reactivity'
import { computed, ref, shallowRef } from '@vue/reactivity'
import type { Patch } from 'immer'
import { applyPatches, enableMapSet, enablePatches, produceWithPatches } from 'immer'

enablePatches()
enableMapSet()

export interface UndoStackItem {
  patches: Patch[]
  inversePatches: Patch[]
}

type UpdaterFn<T> = <R>(
  updater: (draft: T) => R,
  callback?: (
    /**
     * current patches
     */
    patches: Patch[],
    /**
     * inverse patches
     */
    inversePatches: Patch[],
    /**
     * effect update state with out history
     */
    effect: (updater: (draft: T) => void) => void) => void,
) => R
export function useHistory<T>(baseState: T): {
  state: Ref<T>
  update: UpdaterFn<T>
  enable: (value?: boolean) => void
  undo: () => void
  redo: () => void
  isUndoDisable: ComputedRef<boolean>
  isRedoDisable: ComputedRef<boolean>
  undoCount: ComputedRef<number>
  redoCount: ComputedRef<number>
} {
  // 历史记录
  const undoStack = ref<UndoStackItem[]>([])
  // 当前索引
  const undoStackPointer = ref(-1)
  // 是否开启记录
  const undoable = ref(false)

  const state = shallowRef(baseState)
  const update: UpdaterFn<T> = (updater, callback) => {
    let result: any
    // @ts-expect-error produceWithPatches type error
    const [nextState, patches, inversePatches] = produceWithPatches(state.value, (draft: T) => {
      result = updater(draft)
    })
    state.value = nextState

    if (undoable.value && (patches.length && inversePatches.length)) {
      const pointer = ++undoStackPointer.value
      undoStack.value.length = pointer
      undoStack.value[pointer] = {
        patches,
        inversePatches,
      }
      callback?.(patches, inversePatches, (updater) => {
        undoable.value = false
        // @ts-expect-error produceWithPatches type error
        const [nextState] = produceWithPatches(state.value, (draft: T) => {
          updater(draft)
          undoable.value = true
        })
        state.value = nextState
      })
    }
    return result
  }

  function enable(value = true) {
    undoable.value = value
  }

  function undo() {
    if (undoStackPointer.value < 0)
      return
    const patches = undoStack.value[undoStackPointer.value].inversePatches
    state.value = applyPatches(state.value, patches)
    undoStackPointer.value--
  }

  function redo() {
    if (undoStackPointer.value === undoStack.value.length - 1)
      return
    undoStackPointer.value++
    const patches = undoStack.value[undoStackPointer.value].patches
    state.value = applyPatches(state.value, patches)
  }

  const isUndoDisable = computed(
    () => undoStackPointer.value < 0,
  )

  const isRedoDisable = computed(
    () => undoStackPointer.value === undoStack.value.length - 1,
  )

  const undoCount = computed(() => undoStackPointer.value + 1)

  const redoCount = computed(
    () => undoStack.value.length - undoStackPointer.value - 1,
  )

  return {
    state,
    update,
    enable,
    undo,
    redo,
    isUndoDisable,
    isRedoDisable,
    undoCount,
    redoCount,
  }
}
