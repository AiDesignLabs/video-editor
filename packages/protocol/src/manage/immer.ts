import type { ComputedRef, Ref } from '@vue/reactivity'
import type { Patch } from 'immer'
import { computed, ref, shallowRef, toRaw } from '@vue/reactivity'
import { applyPatches, enableMapSet, enablePatches, produceWithPatches } from 'immer'

enablePatches()
enableMapSet()

/**
 * Semantic description of a committed operation.
 *
 * The patches themselves are unreadable to a human reviewing what an agent
 * intends to do, so a transaction may carry a label and an arbitrary payload.
 * This is metadata only: it never participates in undo/redo semantics and is
 * not a deterministic replay format.
 */
export interface TransactionMeta {
  /** Semantic name of the operation, e.g. `split-segment`. */
  label?: string
  /** Arbitrary payload describing the operation, for review UI and audit. */
  data?: Record<string, unknown>
}

export interface OperationLogMeta {
  readonly label?: string
  readonly data?: Readonly<Record<string, unknown>>
}

export interface OperationLogEntry {
  /** Position in the currently reachable history branch. */
  readonly index: number
  /** Undo changes this to `undone`; redo restores `applied`. */
  readonly status: 'applied' | 'undone'
  /** Description of the outer transaction, when it has one. */
  readonly meta?: OperationLogMeta
  /** Direct named transactions committed inside the outer transaction. */
  readonly operations: readonly OperationLogMeta[]
}

export interface UndoStackItem {
  patches: Patch[]
  inversePatches: Patch[]
  meta?: TransactionMeta
  operations: TransactionMeta[]
}

export interface TransactionOptions<T> extends TransactionMeta {
  /** Operations already performed in an isolated proposal preview. */
  operations?: readonly TransactionMeta[]
  /**
   * Runs against the pending state right before the transaction commits.
   * Returning `false` rolls the whole transaction back and leaves the
   * undo/redo stacks untouched.
   */
  validate?: (state: T) => boolean
}

/**
 * - `committed`: changes were applied and a single history item was pushed.
 * - `empty`: the body produced no change, so no history item was pushed.
 * - `cancelled`: explicitly cancelled; state restored to where it began.
 * - `invalid`: `validate` rejected the pending state; state restored.
 * - `nested`: committed into an enclosing transaction rather than into history.
 */
export type TransactionStatus
  = | 'committed'
    | 'empty'
    | 'cancelled'
    | 'invalid'
    | 'nested'

export interface TransactionHandle {
  /** 1 for the outermost transaction. */
  readonly depth: number
  readonly active: boolean
  /**
   * Close the transaction. Only the outermost one reaches history: a nested
   * commit merges its changes into its parent and returns `'nested'`.
   */
  commit: () => TransactionStatus
  /** Restore the state captured when this transaction began. */
  cancel: () => void
}

export interface TransactionResult<R> {
  status: TransactionStatus
  value: R
}

interface TransactionFrame<T> {
  snapshot: T
  patches: Patch[]
  inversePatches: Patch[]
  meta?: TransactionMeta
  operations: TransactionMeta[]
  validate?: (state: T) => boolean
  cancelled: boolean
  closed: boolean
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
    effect: (updater: (draft: T) => void) => void,
  ) => void,
) => R

export interface History<T> {
  state: Ref<T>
  /** Monotonic version of committed state, including undo and redo. */
  revision: ComputedRef<number>
  update: UpdaterFn<T>
  enable: (value?: boolean) => void
  undo: () => boolean
  redo: () => boolean
  isUndoDisable: ComputedRef<boolean>
  isRedoDisable: ComputedRef<boolean>
  undoCount: ComputedRef<number>
  redoCount: ComputedRef<number>
  /** Semantic history only; Immer patches remain private. */
  operationLog: ComputedRef<readonly OperationLogEntry[]>
  /**
   * Open a transaction imperatively. Use this for continuous interactions that
   * span multiple events (pointer down → move → up); prefer `transaction()`
   * for anything that fits in a single synchronous function.
   */
  beginTransaction: (options?: TransactionOptions<T>) => TransactionHandle
  /**
   * Run `body` as one atomic history item. Every `update()` inside it still
   * updates `state` immediately, so previews stay reactive, but only one
   * `UndoStackItem` is pushed when it commits.
   *
   * If `body` throws, the state is restored and the error is rethrown.
   */
  transaction: <R>(
    body: (tx: TransactionHandle) => R,
    options?: TransactionOptions<T>,
  ) => TransactionResult<R>
  /** Whether a transaction is currently open. */
  isTransactionActive: ComputedRef<boolean>
  /** Nesting depth of the open transaction; 0 when none is open. */
  transactionDepth: ComputedRef<number>
}

export function useHistory<T>(baseState: T): History<T> {
  // 历史记录
  const undoStack = ref<UndoStackItem[]>([])
  // 当前索引
  const undoStackPointer = ref(-1)
  // 是否开启记录
  const undoable = ref(false)

  const state = shallowRef(baseState)
  const stateRevision = ref(0)

  // Open transactions, outermost first. A nested transaction reuses the
  // outermost one: it can never push a slice of history on its own.
  // Kept as a plain array: a deep `ref` would proxy the immer snapshots stored
  // in each frame, and restoring one would put a reactive proxy into `state`.
  const frames: TransactionFrame<T>[] = []
  const frameDepth = ref(0)
  const syncDepth = () => {
    frameDepth.value = frames.length
  }
  const currentFrame = () => frames.at(-1)

  const cloneMeta = (meta: TransactionMeta): TransactionMeta => {
    try {
      return {
        ...(meta.label === undefined ? {} : { label: meta.label }),
        ...(meta.data === undefined ? {} : { data: structuredClone(toRaw(meta.data)) }),
      }
    }
    catch (error) {
      throw new TypeError('transaction metadata must be structured-cloneable', { cause: error })
    }
  }

  const pushHistory = (item: UndoStackItem) => {
    const pointer = ++undoStackPointer.value
    undoStack.value.length = pointer
    undoStack.value[pointer] = item
    stateRevision.value++
  }

  const applyEffect = (updater: (draft: T) => void) => {
    const previous = undoable.value
    undoable.value = false
    // @ts-expect-error produceWithPatches type error
    const [nextState] = produceWithPatches(state.value, (draft: T) => {
      updater(draft)
    })
    state.value = nextState
    undoable.value = previous
  }

  const update: UpdaterFn<T> = (updater, callback) => {
    let result: any
    // @ts-expect-error produceWithPatches type error
    const [nextState, patches, inversePatches] = produceWithPatches(state.value, (draft: T) => {
      result = updater(draft)
    })
    state.value = nextState

    if (undoable.value && (patches.length && inversePatches.length)) {
      const frame = currentFrame()
      if (frame) {
        // Inside a transaction: accumulate instead of pushing history now.
        frame.patches.push(...patches)
        frame.inversePatches.push(...inversePatches)
      }
      else {
        pushHistory({ patches, inversePatches, operations: [] })
      }
      callback?.(patches, inversePatches, applyEffect)
    }
    return result
  }

  function enable(value = true) {
    undoable.value = value
  }

  function beginTransaction(options?: TransactionOptions<T>): TransactionHandle {
    const frame: TransactionFrame<T> = {
      snapshot: state.value,
      patches: [],
      inversePatches: [],
      meta: options?.label !== undefined || options?.data !== undefined
        ? cloneMeta({ label: options.label, data: options.data })
        : undefined,
      operations: options?.operations?.map(cloneMeta) ?? [],
      validate: options?.validate,
      cancelled: false,
      closed: false,
    }
    frames.push(frame)
    syncDepth()
    const depth = frames.length

    const close = () => {
      frame.closed = true
      // Discard this frame and everything opened under it. A caller that
      // leaks a nested handle must not be able to strand the stack.
      frames.length = depth - 1
      syncDepth()
    }

    const handle: TransactionHandle = {
      depth,
      get active() {
        return !frame.closed
      },
      commit: () => {
        if (frame.closed)
          return frame.cancelled ? 'cancelled' : 'committed'

        if (frame.cancelled) {
          state.value = frame.snapshot
          close()
          return 'cancelled'
        }

        if (frame.validate && !frame.validate(state.value)) {
          state.value = frame.snapshot
          close()
          return 'invalid'
        }

        // A caller may have leaked a nested handle without closing it. Its
        // changes are already in `state`, so absorb them rather than dropping
        // them from history and leaving the state unable to undo.
        for (const orphan of frames.slice(depth)) {
          if (orphan.cancelled)
            continue
          frame.patches.push(...orphan.patches)
          frame.inversePatches.push(...orphan.inversePatches)
          if (orphan.meta?.label)
            frame.operations.push(cloneMeta(orphan.meta))
          else
            frame.operations.push(...orphan.operations.map(cloneMeta))
        }

        const parent = frames[depth - 2]
        close()

        if (!frame.patches.length)
          return 'empty'

        if (parent) {
          parent.patches.push(...frame.patches)
          parent.inversePatches.push(...frame.inversePatches)
          if (frame.meta?.label)
            parent.operations.push(cloneMeta(frame.meta))
          else
            parent.operations.push(...frame.operations.map(cloneMeta))
          return 'nested'
        }

        pushHistory({
          patches: frame.patches,
          // Inverse patches were accumulated in application order; undo has to
          // walk them backwards.
          inversePatches: [...frame.inversePatches].reverse(),
          meta: frame.meta,
          operations: frame.operations,
        })
        return 'committed'
      },
      cancel: () => {
        if (frame.closed)
          return
        frame.cancelled = true
        state.value = frame.snapshot
        close()
      },
    }

    return handle
  }

  function transaction<R>(
    body: (tx: TransactionHandle) => R,
    options?: TransactionOptions<T>,
  ): TransactionResult<R> {
    const tx = beginTransaction(options)
    let value: R
    try {
      value = body(tx)
    }
    catch (error) {
      tx.cancel()
      throw error
    }
    return { status: tx.commit(), value }
  }

  function undo() {
    // Undoing into a half-applied transaction would desync the frame's
    // snapshot and accumulated patches.
    if (frames.length || undoStackPointer.value < 0)
      return false
    const patches = undoStack.value[undoStackPointer.value].inversePatches
    state.value = applyPatches(state.value, patches)
    undoStackPointer.value--
    stateRevision.value++
    return true
  }

  function redo() {
    if (frames.length || undoStackPointer.value === undoStack.value.length - 1)
      return false
    undoStackPointer.value++
    const patches = undoStack.value[undoStackPointer.value].patches
    state.value = applyPatches(state.value, patches)
    stateRevision.value++
    return true
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

  const operationLog = computed<readonly OperationLogEntry[]>(() => {
    return undoStack.value.map((item, index) => ({
      index,
      status: index <= undoStackPointer.value ? 'applied' : 'undone',
      ...(item.meta === undefined ? {} : { meta: cloneMeta(item.meta) }),
      operations: item.operations.map(cloneMeta),
    }))
  })

  const isTransactionActive = computed(() => frameDepth.value > 0)
  const transactionDepth = computed(() => frameDepth.value)
  const revision = computed(() => stateRevision.value)

  return {
    state,
    revision,
    update,
    enable,
    undo,
    redo,
    isUndoDisable,
    isRedoDisable,
    undoCount,
    redoCount,
    operationLog,
    beginTransaction,
    transaction,
    isTransactionActive,
    transactionDepth,
  }
}
