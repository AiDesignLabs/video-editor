export interface PlaybackStatistics {
  readonly fps: number
  readonly presentedFrames: number
  readonly droppedFrames: number
}

/** Counts completed, distinct timeline frames, rather than animation callbacks. */
export function createPlaybackStatistics() {
  let timestamps: number[] = []
  let startedAt = 0
  let previousFrame: number | undefined
  let presentedFrames = 0
  let droppedFrames = 0
  return {
    reset(now: number) {
      timestamps = []
      startedAt = now
      previousFrame = undefined
      presentedFrames = 0
      droppedFrames = 0
    },
    seek() {
      previousFrame = undefined
    },
    record(frame: number, now: number) {
      if (frame === previousFrame)
        return
      if (previousFrame !== undefined)
        droppedFrames += Math.max(0, frame - previousFrame - 1)
      previousFrame = frame
      presentedFrames++
      timestamps.push(now)
    },
    sample(now: number): PlaybackStatistics {
      timestamps = timestamps.filter(timestamp => timestamp > now - 1000)
      const elapsed = Math.min(1000, Math.max(0, now - startedAt))
      return { fps: elapsed >= 250 ? Math.round(timestamps.length * 10000 / elapsed) / 10 : 0, presentedFrames, droppedFrames }
    },
  }
}
