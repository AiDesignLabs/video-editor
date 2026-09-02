import { describe, expect, it, vi } from 'vitest'
import { createSharedTaskPool } from './media-analysis-pool'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('shared media analysis task pool', () => {
  it('limits distinct tasks while allowing the queue to continue', async () => {
    const pool = createSharedTaskPool(2)
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()]
    const started: number[] = []
    const jobs = gates.map((gate, index) => pool.run(String(index), async () => {
      started.push(index)
      return await gate.promise
    }))

    await Promise.resolve()
    expect(started).toEqual([0, 1])
    gates[0]!.resolve(0)
    await jobs[0]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])

    gates[1]!.resolve(1)
    gates[2]!.resolve(2)
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2])
  })

  it('shares equal tasks and lets one subscriber cancel independently', async () => {
    const pool = createSharedTaskPool(1)
    const gate = deferred<number>()
    const task = vi.fn(async () => await gate.promise)
    const firstController = new AbortController()
    const first = pool.run('same', task, firstController.signal)
    const second = pool.run('same', task)

    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    gate.resolve(42)
    await expect(second).resolves.toBe(42)
    expect(task).toHaveBeenCalledOnce()
  })

  it('removes a cancelled queued task before it starts', async () => {
    const pool = createSharedTaskPool(1)
    const blocker = deferred<void>()
    const first = pool.run('first', async () => await blocker.promise)
    const controller = new AbortController()
    const queuedTask = vi.fn(async () => 2)
    const second = pool.run('second', queuedTask, controller.signal)

    controller.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(queuedTask).not.toHaveBeenCalled()
    blocker.resolve()
    await first
  })

  it('cancels matching shared work for cache invalidation', async () => {
    const pool = createSharedTaskPool(1)
    const job = pool.run('thumbnail::asset-a', async signal => await new Promise<number>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    }))

    pool.cancelMatching(key => key.startsWith('thumbnail::asset-a'))
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
  })
})
