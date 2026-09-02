export const DEFAULT_MEDIA_ANALYSIS_CONCURRENCY = 3

interface SharedTaskEntry<T> {
  controller: AbortController
  promise: Promise<T>
  subscriberCount: number
  settled: boolean
}

interface QueuedTask<T> {
  entry: SharedTaskEntry<T>
  run: (signal: AbortSignal) => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  started: boolean
}

export interface SharedTaskPool {
  run: <T>(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T>
  cancelMatching: (predicate: (key: string) => boolean) => void
}

export function createMediaAnalysisAbortError() {
  return new DOMException('Media analysis cancelled', 'AbortError')
}

export function throwIfMediaAnalysisAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw createMediaAnalysisAbortError()
}

export function isMediaAnalysisAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Shares equal work and limits the total number of media decoders running at once. */
export function createSharedTaskPool(maxConcurrency: number): SharedTaskPool {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0)
    throw new TypeError('createSharedTaskPool: maxConcurrency must be a positive integer')

  const entries = new Map<string, SharedTaskEntry<unknown>>()
  const queue: Array<QueuedTask<unknown>> = []
  let activeCount = 0

  function drain() {
    while (activeCount < maxConcurrency) {
      const queued = queue.shift()
      if (!queued)
        return
      if (queued.entry.settled)
        continue
      if (queued.entry.controller.signal.aborted) {
        queued.reject(createMediaAnalysisAbortError())
        continue
      }

      queued.started = true
      activeCount += 1
      void Promise.resolve()
        .then(() => {
          throwIfMediaAnalysisAborted(queued.entry.controller.signal)
          return queued.run(queued.entry.controller.signal)
        })
        .then(queued.resolve, queued.reject)
        .finally(() => {
          activeCount -= 1
          drain()
        })
    }
  }

  function createEntry<T>(key: string, task: (signal: AbortSignal) => Promise<T>): SharedTaskEntry<T> {
    const controller = new AbortController()
    let resolvePromise!: (value: T) => void
    let rejectPromise!: (reason: unknown) => void
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const entry: SharedTaskEntry<T> = {
      controller,
      promise,
      subscriberCount: 0,
      settled: false,
    }
    const queued: QueuedTask<T> = {
      entry,
      run: task,
      resolve: resolvePromise,
      reject: rejectPromise,
      started: false,
    }

    const settle = () => {
      entry.settled = true
      if (entries.get(key) === entry)
        entries.delete(key)
    }
    void promise.then(settle, settle)
    void promise.catch(() => {})
    controller.signal.addEventListener('abort', () => {
      if (!queued.started)
        rejectPromise(createMediaAnalysisAbortError())
    }, { once: true })

    entries.set(key, entry as SharedTaskEntry<unknown>)
    queue.push(queued as QueuedTask<unknown>)
    drain()
    return entry
  }

  function subscribe<T>(entry: SharedTaskEntry<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted)
      return Promise.reject(createMediaAnalysisAbortError())

    entry.subscriberCount += 1
    return new Promise<T>((resolve, reject) => {
      let finished = false
      function finish(callback: () => void) {
        if (finished)
          return
        finished = true
        signal?.removeEventListener('abort', onAbort)
        entry.controller.signal.removeEventListener('abort', onSharedAbort)
        entry.subscriberCount -= 1
        callback()
        if (entry.subscriberCount === 0 && !entry.settled)
          entry.controller.abort()
      }
      function onAbort() {
        finish(() => reject(createMediaAnalysisAbortError()))
      }
      function onSharedAbort() {
        finish(() => reject(createMediaAnalysisAbortError()))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      entry.controller.signal.addEventListener('abort', onSharedAbort, { once: true })
      void entry.promise.then(
        value => finish(() => resolve(value)),
        reason => finish(() => reject(reason)),
      )
    })
  }

  return {
    run<T>(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
      if (signal?.aborted)
        return Promise.reject(createMediaAnalysisAbortError())
      const existing = entries.get(key) as SharedTaskEntry<T> | undefined
      return subscribe(existing ?? createEntry(key, task), signal)
    },
    cancelMatching(predicate) {
      for (const [key, entry] of entries) {
        if (predicate(key))
          entry.controller.abort()
      }
    },
  }
}

export const mediaAnalysisPool = createSharedTaskPool(DEFAULT_MEDIA_ANALYSIS_CONCURRENCY)
