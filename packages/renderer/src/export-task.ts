import type { IVideoProtocol } from '@video-editor/shared'
import type { Ref } from '@vue/reactivity'
import type { ComposePerformance, ComposeProtocolOptions } from './compose'
import { readonly, shallowRef } from '@vue/reactivity'
import { composeProtocol } from './compose'

/**
 * The shared async-task states. An export is either waiting to start, running,
 * finished with a result, finished with an error, or stopped by the user —
 * there is no state in which a caller has to guess which of those happened.
 */
export type ExportTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

export interface ExportTaskResult {
  blob: Blob
  /** Container mime type, e.g. `video/mp4`. */
  mimeType: string
  /** Container file extension including the dot, e.g. `.mp4`. */
  fileExtension: string
  byteLength: number
  durationMs: number
  width: number
  height: number
  /** Total wall-clock time spent exporting. */
  elapsedMs: number
  /** Exported media seconds per wall-clock second. `1` means realtime speed. */
  realtimeFactor: number
  /** Detailed compose phase timing, finalized with the result. */
  performance: ComposePerformance
}

export interface ExportTaskState {
  status: ExportTaskStatus
  /** 0…1. Stays at its last value when the task fails or is cancelled. */
  progress: number
  /** Wall-clock time spent on the current attempt. */
  elapsedMs: number
  /** Processed media duration divided by elapsed time. */
  realtimeFactor: number
  /** Present once the task succeeds. */
  result?: ExportTaskResult
  /** Present once the task fails. Cancelling is not a failure and sets no error. */
  error?: Error
  /** Whether `retry()` would do anything. */
  canRetry: boolean
}

export interface ExportTaskOptions extends Omit<ComposeProtocolOptions, 'onProgress' | 'signal'> {
  /**
   * Receives the container bytes instead of collecting them into a `Blob`.
   * Use it to stream a long export straight to disk; `state.result.blob` is
   * then an empty placeholder and `byteLength` counts what was written.
   */
  sink?: WritableStream<Uint8Array>
}

export interface ExportTask {
  /** Reactive, read-only. Bind a task centre, a drawer or a dialog to it. */
  readonly state: Readonly<Ref<ExportTaskState>>
  /**
   * Start the export. Calling it again while the task is running returns the
   * same promise rather than starting a second encode of the same request.
   */
  start: () => Promise<ExportTaskState>
  /** Re-run a failed or cancelled task with the options it was created with. */
  retry: () => Promise<ExportTaskState>
  /** Stop a running export and release its decoder, renderer and encoder. */
  cancel: () => void
  /** Cancel if running and drop the collected result. */
  destroy: () => void
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isAbort(error: Error): boolean {
  return error.name === 'AbortError'
}

/**
 * One export, as a task with an observable lifecycle.
 *
 * The protocol is snapshotted when the task is created, not read live: an
 * export that took the user's edits as they arrived would write a file whose
 * first half and second half describe different projects.
 *
 * The task holds no view state and touches no DOM, so a host can render it as a
 * drawer, a dialog or a row in a task centre.
 */
export function createExportTask(
  protocol: IVideoProtocol,
  options: ExportTaskOptions = {},
): ExportTask {
  // Structured clone rather than a reference: the caller's protocol is reactive
  // and will keep changing while this runs.
  const snapshot = structuredClone(protocol) as IVideoProtocol
  const { sink, ...composeOptions } = options

  const state = shallowRef<ExportTaskState>({
    status: 'pending',
    progress: 0,
    elapsedMs: 0,
    realtimeFactor: 0,
    canRetry: false,
  })

  const patch = (next: Partial<ExportTaskState>) => {
    state.value = { ...state.value, ...next }
  }

  let running: Promise<ExportTaskState> | undefined
  let controller: AbortController | undefined
  const durationMs = snapshot.tracks.reduce((maximum, track) => {
    return track.children.reduce((trackMaximum, segment) => Math.max(trackMaximum, segment.endTime), maximum)
  }, 0)

  async function run(): Promise<ExportTaskState> {
    controller = new AbortController()
    const startedAt = performance.now()
    const timing = (progress = state.value.progress) => {
      const elapsedMs = Math.max(0, performance.now() - startedAt)
      return {
        elapsedMs,
        realtimeFactor: elapsedMs > 0 ? durationMs * progress / elapsedMs : 0,
      }
    }
    patch({
      status: 'running',
      progress: 0,
      elapsedMs: 0,
      realtimeFactor: 0,
      result: undefined,
      error: undefined,
      canRetry: false,
    })
    const timingTimer = globalThis.setInterval(() => {
      if (state.value.status === 'running')
        patch(timing())
    }, 200)

    let composed: Awaited<ReturnType<typeof composeProtocol>> | undefined
    try {
      composed = await composeProtocol(snapshot, {
        ...composeOptions,
        signal: controller.signal,
        onProgress: (progress) => {
          // A cancelled task must not keep animating a progress bar.
          if (state.value.status === 'running')
            patch({ progress, ...timing(progress) })
        },
      })

      // `completion` is what distinguishes a finished encode from one that died
      // halfway: the stream closes either way, so reading it alone would hand
      // us a truncated file to present as a success.
      const [written] = await Promise.all([
        drain(composed.stream, sink),
        composed.completion,
      ])

      const finalTiming = timing(1)
      patch({
        status: 'success',
        progress: 1,
        ...finalTiming,
        canRetry: false,
        result: {
          blob: written.blob,
          byteLength: written.byteLength,
          mimeType: composed.mimeType,
          fileExtension: composed.fileExtension,
          durationMs: composed.durationMs,
          width: composed.width,
          height: composed.height,
          ...finalTiming,
          performance: { ...composed.performance },
        },
      })
    }
    catch (err) {
      const error = toError(err)
      composed?.destroy()
      if (isAbort(error) || controller.signal.aborted)
        patch({ status: 'cancelled', ...timing(), canRetry: true })
      else
        patch({ status: 'failed', ...timing(), error, canRetry: true })
    }
    finally {
      globalThis.clearInterval(timingTimer)
      running = undefined
    }

    return state.value
  }

  const start = () => {
    if (running)
      return running
    if (state.value.status === 'success')
      return Promise.resolve(state.value)
    running = run()
    return running
  }

  const cancel = () => {
    if (state.value.status !== 'running')
      return
    controller?.abort()
  }

  return {
    state: readonly(state) as Readonly<Ref<ExportTaskState>>,
    start,
    retry: () => {
      if (running)
        return running
      running = run()
      return running
    },
    cancel,
    destroy: () => {
      cancel()
      patch({ result: undefined })
    },
  }
}

/**
 * Move the container bytes to their destination.
 *
 * With a sink the bytes are forwarded as they arrive and never held in memory;
 * without one they are collected into a `Blob`, which is what a host that wants
 * an object URL needs.
 */
async function drain(
  stream: ReadableStream<Uint8Array>,
  sink?: WritableStream<Uint8Array>,
): Promise<{ blob: Blob, byteLength: number }> {
  if (sink) {
    let byteLength = 0
    await stream
      .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          byteLength += chunk.byteLength
          controller.enqueue(chunk)
        },
      }))
      .pipeTo(sink)
    return { blob: new Blob([]), byteLength }
  }

  const blob = await new Response(stream).blob()
  return { blob, byteLength: blob.size }
}
