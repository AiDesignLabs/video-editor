import { describe, expect, it, vi } from 'vitest'
import { useHistory } from './immer'

interface TestState {
  count: number
  items: { id: string, value: number }[]
}

function createHistory(initial?: Partial<TestState>) {
  const history = useHistory<TestState>({
    count: 0,
    items: [],
    ...initial,
  })
  history.enable()
  return history
}

describe('useHistory basics', () => {
  it('pushes one history item per update outside a transaction', () => {
    const { update, undoCount, state } = createHistory()

    update((draft) => {
      draft.count = 1
    })
    update((draft) => {
      draft.count = 2
    })

    expect(state.value.count).toBe(2)
    expect(undoCount.value).toBe(2)
  })

  it('does not record while history is disabled', () => {
    const { update, enable, undoCount } = createHistory()
    enable(false)

    update((draft) => {
      draft.count = 1
    })

    expect(undoCount.value).toBe(0)
  })

  it('reports whether undo and redo did anything', () => {
    const { update, undo, redo } = createHistory()

    expect(undo()).toBe(false)
    expect(redo()).toBe(false)

    update((draft) => {
      draft.count = 1
    })

    expect(undo()).toBe(true)
    expect(redo()).toBe(true)
  })
})

describe('transaction commit', () => {
  it('collapses many updates into a single history item', () => {
    const { transaction, update, state, undoCount, undo } = createHistory()

    const result = transaction(() => {
      update((draft) => {
        draft.count = 1
      })
      update((draft) => {
        draft.items.push({ id: 'a', value: 10 })
      })
      update((draft) => {
        draft.items.push({ id: 'b', value: 20 })
      })
      return 'done'
    })

    expect(result.status).toBe('committed')
    expect(result.value).toBe('done')
    expect(undoCount.value).toBe(1)
    expect(state.value.count).toBe(1)
    expect(state.value.items).toHaveLength(2)

    undo()

    expect(state.value.count).toBe(0)
    expect(state.value.items).toHaveLength(0)
    expect(undoCount.value).toBe(0)
  })

  it('replays every change of the transaction on redo', () => {
    const { transaction, update, state, undo, redo } = createHistory()

    transaction(() => {
      update((draft) => {
        draft.count = 5
      })
      update((draft) => {
        draft.items.push({ id: 'a', value: 1 })
      })
    })

    undo()
    redo()

    expect(state.value.count).toBe(5)
    expect(state.value.items).toEqual([{ id: 'a', value: 1 }])
  })

  it('undoes interleaved updates in reverse order', () => {
    const { transaction, update, state, undo } = createHistory({ count: 1 })

    transaction(() => {
      update((draft) => {
        draft.count = 2
      })
      update((draft) => {
        draft.count = 3
      })
      update((draft) => {
        draft.count = 4
      })
    })

    expect(state.value.count).toBe(4)
    undo()
    expect(state.value.count).toBe(1)
  })

  it('keeps state updates visible while the transaction is open', () => {
    const { transaction, update, state } = createHistory()
    const seen: number[] = []

    transaction(() => {
      update((draft) => {
        draft.count = 1
      })
      seen.push(state.value.count)
      update((draft) => {
        draft.count = 2
      })
      seen.push(state.value.count)
    })

    expect(seen).toEqual([1, 2])
  })

  it('carries semantic metadata on the committed item', () => {
    const { transaction, update, undo, state } = createHistory()

    transaction(() => {
      update((draft) => {
        draft.count = 1
      })
    }, { label: 'split-segment', data: { segmentId: 'a' } })

    // Metadata is not part of undo semantics: the entry still undoes normally.
    undo()
    expect(state.value.count).toBe(0)
  })
})

describe('empty transaction', () => {
  it('does not create a history item', () => {
    const { transaction, undoCount, redoCount } = createHistory()

    const result = transaction(() => {})

    expect(result.status).toBe('empty')
    expect(undoCount.value).toBe(0)
    expect(redoCount.value).toBe(0)
  })

  it('does not clear the redo stack', () => {
    const { update, transaction, undo, redoCount } = createHistory()

    update((draft) => {
      draft.count = 1
    })
    undo()
    expect(redoCount.value).toBe(1)

    transaction(() => {})

    expect(redoCount.value).toBe(1)
  })

  it('treats a transaction whose updates cancel out as a real commit', () => {
    // The patches are non-empty even though the end state matches, so this is
    // still one history item rather than an empty transaction.
    const { transaction, update, undoCount, state } = createHistory()

    transaction(() => {
      update((draft) => {
        draft.count = 1
      })
      update((draft) => {
        draft.count = 0
      })
    })

    expect(state.value.count).toBe(0)
    expect(undoCount.value).toBe(1)
  })
})

describe('transaction rollback', () => {
  it('restores the state and leaves the stacks untouched when cancelled', () => {
    const { update, transaction, undo, state, undoCount, redoCount } = createHistory()

    update((draft) => {
      draft.count = 1
    })
    update((draft) => {
      draft.count = 2
    })
    undo()

    expect(undoCount.value).toBe(1)
    expect(redoCount.value).toBe(1)

    const result = transaction((tx) => {
      update((draft) => {
        draft.count = 99
        draft.items.push({ id: 'x', value: 0 })
      })
      tx.cancel()
    })

    expect(result.status).toBe('cancelled')
    expect(state.value.count).toBe(1)
    expect(state.value.items).toHaveLength(0)
    expect(undoCount.value).toBe(1)
    expect(redoCount.value).toBe(1)
  })

  it('rolls back and rethrows when the body throws', () => {
    const { update, transaction, state, undoCount } = createHistory()

    update((draft) => {
      draft.count = 1
    })

    expect(() => transaction(() => {
      update((draft) => {
        draft.count = 42
      })
      throw new Error('boom')
    })).toThrow('boom')

    expect(state.value.count).toBe(1)
    expect(undoCount.value).toBe(1)
  })

  it('rolls back when validate rejects the pending state', () => {
    const { transaction, update, state, undoCount } = createHistory()
    const validate = vi.fn((next: TestState) => next.count <= 10)

    const result = transaction(() => {
      update((draft) => {
        draft.count = 50
      })
    }, { validate })

    expect(result.status).toBe('invalid')
    expect(validate).toHaveBeenCalledTimes(1)
    expect(state.value.count).toBe(0)
    expect(undoCount.value).toBe(0)
  })

  it('commits when validate accepts the pending state', () => {
    const { transaction, update, state, undoCount } = createHistory()

    const result = transaction(() => {
      update((draft) => {
        draft.count = 5
      })
    }, { validate: next => next.count <= 10 })

    expect(result.status).toBe('committed')
    expect(state.value.count).toBe(5)
    expect(undoCount.value).toBe(1)
  })
})

describe('nested transactions', () => {
  it('reuses the outermost transaction and pushes one item', () => {
    const { transaction, update, undoCount, state, undo } = createHistory()

    transaction(() => {
      update((draft) => {
        draft.count = 1
      })
      const inner = transaction(() => {
        update((draft) => {
          draft.items.push({ id: 'a', value: 1 })
        })
      })
      expect(inner.status).toBe('nested')
      expect(undoCount.value).toBe(0)
    })

    expect(undoCount.value).toBe(1)
    undo()
    expect(state.value).toEqual({ count: 0, items: [] })
  })

  it('rolls the inner transaction back without ending the outer one', () => {
    const { transaction, update, state, undoCount, undo } = createHistory()

    transaction(() => {
      update((draft) => {
        draft.count = 1
      })

      const inner = transaction((tx) => {
        update((draft) => {
          draft.count = 100
        })
        tx.cancel()
      })
      expect(inner.status).toBe('cancelled')
      expect(state.value.count).toBe(1)

      update((draft) => {
        draft.items.push({ id: 'a', value: 1 })
      })
    })

    expect(state.value.count).toBe(1)
    expect(state.value.items).toHaveLength(1)
    expect(undoCount.value).toBe(1)

    undo()
    expect(state.value).toEqual({ count: 0, items: [] })
  })

  it('cancelling the outer transaction discards inner commits too', () => {
    const { transaction, update, state, undoCount } = createHistory()

    const result = transaction((tx) => {
      transaction(() => {
        update((draft) => {
          draft.count = 7
        })
      })
      tx.cancel()
    })

    expect(result.status).toBe('cancelled')
    expect(state.value.count).toBe(0)
    expect(undoCount.value).toBe(0)
  })

  it('reports the nesting depth', () => {
    const { transaction, transactionDepth, isTransactionActive } = createHistory()

    expect(isTransactionActive.value).toBe(false)

    transaction(() => {
      expect(transactionDepth.value).toBe(1)
      transaction(() => {
        expect(transactionDepth.value).toBe(2)
      })
      expect(transactionDepth.value).toBe(1)
    })

    expect(transactionDepth.value).toBe(0)
    expect(isTransactionActive.value).toBe(false)
  })
})

describe('imperative transactions', () => {
  it('collapses a continuous interaction into one history item', () => {
    const { beginTransaction, update, state, undoCount, undo } = createHistory()

    // pointer down
    const tx = beginTransaction({ label: 'drag-segment' })
    // pointer move × N
    for (const value of [10, 20, 30]) {
      update((draft) => {
        draft.count = value
      })
      expect(state.value.count).toBe(value)
      expect(undoCount.value).toBe(0)
    }
    // pointer up
    expect(tx.commit()).toBe('committed')

    expect(undoCount.value).toBe(1)
    undo()
    expect(state.value.count).toBe(0)
  })

  it('restores the pre-interaction state when the interaction is cancelled', () => {
    const { beginTransaction, update, state, undoCount } = createHistory({ count: 3 })

    const tx = beginTransaction()
    update((draft) => {
      draft.count = 10
    })
    tx.cancel()

    expect(state.value.count).toBe(3)
    expect(undoCount.value).toBe(0)
    expect(tx.active).toBe(false)
  })

  it('ignores commit and cancel after the transaction is closed', () => {
    const { beginTransaction, update, state, undoCount } = createHistory()

    const tx = beginTransaction()
    update((draft) => {
      draft.count = 1
    })
    tx.commit()

    tx.commit()
    tx.cancel()

    expect(undoCount.value).toBe(1)
    expect(state.value.count).toBe(1)
  })

  it('closes leaked nested transactions when the outer one commits', () => {
    const { beginTransaction, update, transactionDepth, undoCount } = createHistory()

    const outer = beginTransaction()
    beginTransaction()
    update((draft) => {
      draft.count = 1
    })
    outer.commit()

    expect(transactionDepth.value).toBe(0)
    expect(undoCount.value).toBe(1)
  })
})

describe('transaction interaction with undo and redo', () => {
  it('clears the redo stack only when the transaction commits', () => {
    const { update, beginTransaction, undo, redoCount } = createHistory()

    update((draft) => {
      draft.count = 1
    })
    undo()
    expect(redoCount.value).toBe(1)

    const tx = beginTransaction()
    update((draft) => {
      draft.count = 5
    })
    expect(redoCount.value).toBe(1)

    tx.commit()
    expect(redoCount.value).toBe(0)
  })

  it('refuses to undo or redo while a transaction is open', () => {
    const { update, beginTransaction, undo, redo, state } = createHistory()

    update((draft) => {
      draft.count = 1
    })

    const tx = beginTransaction()
    update((draft) => {
      draft.count = 2
    })

    expect(undo()).toBe(false)
    expect(redo()).toBe(false)
    expect(state.value.count).toBe(2)

    tx.commit()
    expect(undo()).toBe(true)
    expect(state.value.count).toBe(1)
  })

  it('keeps editing normally after a transaction commits', () => {
    const { transaction, update, state, undoCount, undo } = createHistory()

    transaction(() => {
      update((draft) => {
        draft.count = 1
      })
    })
    update((draft) => {
      draft.count = 2
    })

    expect(undoCount.value).toBe(2)
    undo()
    expect(state.value.count).toBe(1)
    undo()
    expect(state.value.count).toBe(0)
  })
})
