import type { IAudioSegment, IVideoProtocol } from '@video-editor/shared'
import type { MP4Clip, AudioClip } from '@webav/av-cliper'
import { collectActiveSegments } from './helpers'
import { AudioClip as WebAVAudioClip } from '@webav/av-cliper'

interface ClipEntry {
  clip: AudioClip
  ready: Promise<unknown>
}

interface LoopState {
  stop: () => void
  sources: AudioBufferSourceNode[]
  isStopped: () => boolean
}

interface AudioLoopContext {
  segment: IAudioSegment
  startedAt: number // ctx.currentTime when loop started
  segmentRelativeMs: number // position in segment when loop started
}

interface Mp4State {
  loop: LoopState
  startUs: number
  startCtxTime: number
  fps: number
  nextStartAt?: number
}

interface AudioElementState {
  segmentId: string
  url: string
  el: HTMLAudioElement
  pendingPlay?: Promise<void>
  lastTimelineMs?: number
  lastSourceSec?: number
  lastSeekTimelineMs?: number
}

export class AudioManager {
  private protocol: IVideoProtocol
  private clips = new Map<string, ClipEntry>()
  private loadingClips = new Map<string, Promise<ClipEntry | undefined>>()
  private audioLoops = new Map<string, LoopState>()
  private audioLoopContexts = new Map<string, AudioLoopContext>()
  private mp4Loops = new Map<string, LoopState>()
  private mp4States = new Map<string, Mp4State>()
  private audioGains = new Map<string, GainNode>()
  private mp4Gains = new Map<string, GainNode>()
  private audioElements = new Map<string, AudioElementState>()
  private readonly useMediaElementForAudio = true
  private ctx: AudioContext
  private lastTime = 0

  constructor(protocol: IVideoProtocol) {
    this.protocol = protocol
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }

  public setProtocol(protocol: IVideoProtocol) {
    this.protocol = protocol
  }

  public async sync(currentTime: number, isPlaying: boolean) {
    if (!isPlaying) {
      // Always stop all audio when paused
      this.stopAll()
      this.lastTime = currentTime
      return
    }

    if (this.ctx.state === 'suspended')
      await this.ctx.resume().catch(() => {})

    if (Math.abs(currentTime - this.lastTime) > 1000)
      this.stopAll()
    this.lastTime = currentTime

    const activeSegments = collectActiveSegments(this.protocol, currentTime)
    const activeAudioKeys = new Set<string>()
    const activeVideoKeys = new Set<string>()

    for (const { segment } of activeSegments) {
      if (segment.segmentType === 'audio') {
        const key = this.audioKey(segment.id)
        activeAudioKeys.add(key)
        if (this.useMediaElementForAudio)
          this.syncAudioElement(segment as IAudioSegment, currentTime)
        else
          this.ensureAudioLoop(segment as IAudioSegment, currentTime)
      }
      else if (segment.segmentType === 'frames' && 'type' in segment && segment.type === 'video') {
        const key = this.videoKey(segment.id)
        activeVideoKeys.add(key)
      }
    }

    for (const [key, loop] of this.audioLoops) {
      if (!activeAudioKeys.has(key)) {
        loop.stop()
        // Stop all audio buffer sources
        for (const source of loop.sources) {
          try {
            source.stop()
            source.disconnect()
          }
          catch (e) {
            // Source may already be stopped or disconnected
          }
        }
        this.audioLoops.delete(key)
        this.audioLoopContexts.delete(key)
        this.audioGains.delete(key)
      }
    }

    for (const [key, state] of this.audioElements) {
      if (activeAudioKeys.has(key))
        continue
      try {
        state.el.pause()
        state.pendingPlay = undefined
        state.lastTimelineMs = undefined
        state.lastSourceSec = undefined
        state.lastSeekTimelineMs = undefined
      }
      catch (e) {
        // Ignore media element pause failures.
      }
      if (!this.findSegmentInProtocol(state.segmentId)) {
        this.destroyAudioElement(state.el)
        this.audioElements.delete(key)
      }
    }

    for (const [key, loop] of this.mp4Loops) {
      if (!activeVideoKeys.has(key)) {
        loop.stop()
        // Stop all audio buffer sources
        for (const source of loop.sources) {
          try {
            source.stop()
            source.disconnect()
          }
          catch (e) {
            // Source may already be stopped or disconnected
          }
        }
        this.mp4Loops.delete(key)
        this.mp4States.delete(key)
        this.mp4Gains.delete(key)
      }
    }

    // Also clean up mp4States that don't have active loops (direct playback mode)
    for (const key of this.mp4States.keys()) {
      if (!activeVideoKeys.has(key) && !this.mp4Loops.has(key)) {
        this.mp4States.delete(key)
        this.mp4Gains.delete(key)
      }
    }
  }

  /**
   * Play audio frames from MP4 video directly.
   * Called by renderer after it gets audio data from clip.tick()
   */
  public playMp4AudioFrames(id: string, audio: Float32Array[] | undefined, sampleRate: number) {
    if (!audio || audio.length === 0 || !audio[0]?.length)
      return

    const key = this.videoKey(id)
    const volume = this.getSegmentVolume(id)
    const gainNode = this.getOrCreateGain(this.mp4Gains, key, volume)

    if (this.ctx.state === 'suspended')
      this.ctx.resume().catch(() => {})

    // Get or initialize the playback state for this video
    let state = this.mp4States.get(key)
    if (!state) {
      state = {
        loop: { stop: () => {}, sources: [], isStopped: () => false },
        startUs: 0,
        startCtxTime: this.ctx.currentTime,
        fps: 30,
        nextStartAt: 0,
      }
      this.mp4States.set(key, state)
    }

    // Play the audio frames
    state.nextStartAt = this.playFrames(audio, sampleRate, state.nextStartAt ?? 0, gainNode, state.loop.sources)
  }

  /**
   * Reset MP4 audio playback state (call when seeking or pausing)
   */
  public resetMp4Audio(id: string) {
    const key = this.videoKey(id)
    const state = this.mp4States.get(key)
    if (state) {
      state.nextStartAt = 0
    }
  }

  /**
   * Stop and clean up MP4 audio for a video segment
   */
  public stopMp4Audio(id: string) {
    const key = this.videoKey(id)
    const state = this.mp4States.get(key)
    if (state) {
      state.loop.stop()
      // Stop all audio buffer sources
      for (const source of state.loop.sources) {
        try {
          source.stop()
          source.disconnect()
        }
        catch (e) {
          // Source may already be stopped or disconnected
        }
      }
      this.mp4Loops.delete(key)
      this.mp4States.delete(key)
      this.mp4Gains.delete(key)
    }
  }

  /**
   * @deprecated Use playMp4AudioFrames instead
   */
  public ensureMp4Audio(id: string, clip: MP4Clip, startUs: number, fps: number) {
    // Legacy method - kept for compatibility but should not be used
    // The new approach is to pass audio data directly via playMp4AudioFrames
    const key = this.videoKey(id)
    const volume = this.getSegmentVolume(id)
    const gainNode = this.getOrCreateGain(this.mp4Gains, key, volume)
    const existing = this.mp4States.get(key)
    if (existing) {
      gainNode.gain.value = Math.max(0, volume)
      const elapsedUs = (this.ctx.currentTime - existing.startCtxTime) * 1e6
      const expectedUs = existing.startUs + elapsedUs
      if (Math.abs(expectedUs - startUs) < 150000 && existing.fps === fps)
        return
      existing.loop.stop()
      // Stop all audio buffer sources
      for (const source of existing.loop.sources) {
        try {
          source.stop()
          source.disconnect()
        }
        catch (e) {
          // Source may already be stopped or disconnected
        }
      }
      this.mp4Loops.delete(key)
      this.mp4States.delete(key)
    }
    if (this.ctx.state === 'suspended')
      this.ctx.resume().catch(() => {})
    const loop = this.startMp4Loop(clip, startUs, fps, gainNode)
    this.mp4Loops.set(key, loop)
    this.mp4States.set(key, {
      loop,
      startUs,
      startCtxTime: this.ctx.currentTime,
      fps,
    })
  }

  public destroy() {
    this.stopAll()
    for (const entry of this.clips.values())
      entry.clip.destroy()
    this.clips.clear()
    for (const state of this.audioElements.values())
      this.destroyAudioElement(state.el)
    this.audioElements.clear()
  }

  private stopAll() {
    for (const state of this.audioElements.values()) {
      try {
        state.el.pause()
        state.pendingPlay = undefined
        state.lastTimelineMs = undefined
        state.lastSourceSec = undefined
        state.lastSeekTimelineMs = undefined
      }
      catch (e) {
        // Ignore media element pause failures.
      }
    }

    for (const loop of this.audioLoops.values()) {
      loop.stop()
      // Stop all audio buffer sources immediately
      for (const source of loop.sources) {
        try {
          source.stop(0)
          source.disconnect()
        }
        catch (e) {
          // Source may already be stopped or disconnected
        }
      }
      loop.sources.length = 0
    }
    for (const loop of this.mp4Loops.values()) {
      loop.stop()
      // Stop all audio buffer sources immediately
      for (const source of loop.sources) {
        try {
          source.stop(0)
          source.disconnect()
        }
        catch (e) {
          // Source may already be stopped or disconnected
        }
      }
      loop.sources.length = 0
    }
    // Disconnect all gain nodes to completely silence audio
    for (const gain of this.audioGains.values()) {
      try {
        gain.disconnect()
      }
      catch (e) {
        // Gain may already be disconnected
      }
    }
    for (const gain of this.mp4Gains.values()) {
      try {
        gain.disconnect()
      }
      catch (e) {
        // Gain may already be disconnected
      }
    }
    this.audioLoops.clear()
    this.audioLoopContexts.clear()
    this.audioGains.clear()
    this.mp4Loops.clear()
    this.mp4States.clear()
    this.mp4Gains.clear()
  }

  private async ensureAudioLoop(segment: IAudioSegment, currentTime: number) {
    const key = this.audioKey(segment.id)
    const entry = await this.loadClip(segment)
    if (!entry)
      return
    const offset = segment.fromTime ?? 0
    const playRate = this.normalizePlayRate(segment.playRate)
    // relativeMs is position within segment timeline (not source audio)
    const relativeMs = currentTime - segment.startTime
    // sourceOffsetMs is where we are in the source audio (accounting for fromTime and playRate)
    const sourceOffsetMs = offset + relativeMs * playRate
    const gainNode = this.getOrCreateGain(this.audioGains, key, segment.volume)

    // Apply fade in/out to gain
    this.applyFadeToGain(segment, relativeMs, gainNode)

    const existingLoop = this.audioLoops.get(key)
    if (existingLoop && !existingLoop.isStopped()) {
      // Loop is still running, just update volume with fade
      return
    }
    // Clean up stopped loop if exists
    if (existingLoop) {
      this.audioLoops.delete(key)
      this.audioLoopContexts.delete(key)
    }
    // Calculate segment duration in microseconds
    const segmentDurationMs = segment.endTime - segment.startTime
    const sourceDurationMs = segmentDurationMs * playRate
    const maxSourceOffsetMs = offset + sourceDurationMs

    const loop = this.startAudioLoop(entry.clip, Math.max(0, sourceOffsetMs) * 1000, gainNode, playRate, maxSourceOffsetMs * 1000)
    this.audioLoops.set(key, loop)
    this.audioLoopContexts.set(key, {
      segment,
      startedAt: this.ctx.currentTime,
      segmentRelativeMs: relativeMs,
    })
  }

  private syncAudioElement(segment: IAudioSegment, currentTime: number) {
    const key = this.audioKey(segment.id)
    const state = this.getOrCreateAudioElementState(key, segment)
    const relativeMs = currentTime - segment.startTime
    const playRate = this.normalizePlayRate(segment.playRate)
    const offset = segment.fromTime ?? 0
    const sourceOffsetMs = offset + relativeMs * playRate
    const segmentDurationMs = Math.max(0, segment.endTime - segment.startTime)
    const sourceDurationMs = segmentDurationMs * playRate
    const maxSourceOffsetMs = offset + sourceDurationMs
    const segmentMaxSourceSec = Math.max(0, maxSourceOffsetMs) / 1000
    const mediaDurationSec = Number.isFinite(state.el.duration) ? Math.max(0, state.el.duration) : undefined
    const effectiveMaxSourceSec = mediaDurationSec === undefined
      ? segmentMaxSourceSec
      : Math.min(segmentMaxSourceSec, mediaDurationSec)
    const targetSourceSec = Math.max(0, Math.min(sourceOffsetMs / 1000, effectiveMaxSourceSec))
    const isSourceExhausted = sourceOffsetMs / 1000 >= (effectiveMaxSourceSec - 0.01)

    if (Math.abs(state.el.playbackRate - playRate) > 0.001)
      state.el.playbackRate = playRate

    const targetVolume = this.computeSegmentVolume(segment, relativeMs)
    if (Math.abs(state.el.volume - targetVolume) > 0.001)
      state.el.volume = targetVolume

    // Avoid per-frame seeking (causes pops/crackles). Only resync on
    // activation, large timeline jumps, or accumulated drift.
    const seekDriftThresholdSec = 0.24
    const seekCooldownMs = 500
    const largeJumpMs = 300
    const rewindMs = -40
    const lastTimelineMs = state.lastTimelineMs
    const lastSourceSec = state.lastSourceSec
    const deltaTimelineMs = lastTimelineMs === undefined ? 0 : (currentTime - lastTimelineMs)

    let shouldSeek = false
    if (lastTimelineMs === undefined) {
      shouldSeek = true
    }
    else if (deltaTimelineMs < rewindMs || deltaTimelineMs > largeJumpMs) {
      shouldSeek = true
    }
    else if (lastSourceSec !== undefined) {
      const predictedSourceSec = lastSourceSec + (deltaTimelineMs * playRate / 1000)
      const driftSec = Math.abs(predictedSourceSec - targetSourceSec)
      const cooldownPassed = state.lastSeekTimelineMs === undefined || (currentTime - state.lastSeekTimelineMs) >= seekCooldownMs
      if (driftSec > seekDriftThresholdSec && cooldownPassed)
        shouldSeek = true
    }

    if (shouldSeek && Math.abs(state.el.currentTime - targetSourceSec) > 0.06) {
      try {
        state.el.currentTime = targetSourceSec
        state.lastSeekTimelineMs = currentTime
      }
      catch (e) {
        // Ignore seek failures while metadata is not ready.
      }
    }

    state.lastTimelineMs = currentTime
    state.lastSourceSec = targetSourceSec

    if (isSourceExhausted) {
      if (!state.el.paused) {
        try {
          state.el.pause()
        }
        catch (e) {
          // Ignore media element pause failures.
        }
      }
      state.pendingPlay = undefined
      return
    }

    if (state.el.paused && !state.pendingPlay) {
      const maybePromise = state.el.play()
      if (maybePromise && typeof maybePromise.then === 'function') {
        state.pendingPlay = maybePromise
          .catch(() => {})
          .finally(() => {
            state.pendingPlay = undefined
          })
      }
    }
  }

  private applyFadeToGain(segment: IAudioSegment, relativeMs: number, gainNode: GainNode) {
    gainNode.gain.value = this.computeSegmentVolume(segment, relativeMs)
  }

  private startMp4Loop(clip: MP4Clip, startUs: number, fps: number, gainNode: GainNode): LoopState {
    let stopped = false
    let timeUs = startUs
    let startAt = 0
    let first = true
    const stepUs = Math.round((1000 / Math.max(fps || 30, 1)) * 1000)
    const sampleRate = this.getClipSampleRate(clip)
    const sources: AudioBufferSourceNode[] = []

    const timer = window.setInterval(async () => {
      if (stopped)
        return
      const { audio, state } = await clip.tick(Math.round(timeUs))
      timeUs += stepUs
      if (state === 'done')
        return
      if (first) {
        first = false
        return
      }
      const len = audio?.[0]?.length ?? 0
      if (len === 0)
        return
      startAt = this.playFrames(audio as Float32Array[], sampleRate, startAt, gainNode, sources)
    }, Math.round(1000 / Math.max(fps || 30, 1)))

    return {
      sources,
      stop: () => {
        stopped = true
        window.clearInterval(timer)
      },
      isStopped: () => stopped,
    }
  }

  private startAudioLoop(clip: AudioClip, startUs: number, gainNode: GainNode, playRate: number = 1, maxSourceOffsetUs?: number): LoopState {
    let stopped = false
    let timeUs = startUs
    let startAt = 0
    let initialized = false
    const sampleRate = this.getClipSampleRate(clip)
    const sources: AudioBufferSourceNode[] = []
    // Each iteration fetches 100ms of real-time audio
    // For playRate != 1, we need to fetch more/less source audio
    const realTimeStepUs = 100000
    const sourceStepUs = Math.round(realTimeStepUs * playRate)

    const play = async () => {
      if (stopped)
        return

      if (!initialized) {
        // First tick: seek to startUs position (discard audio before startUs)
        if (startUs > 0) {
          await clip.tick(startUs)
        }
        initialized = true
      }

      timeUs += sourceStepUs

      // Check if we've reached the maximum duration for this segment
      if (maxSourceOffsetUs !== undefined && timeUs > maxSourceOffsetUs) {
        stopped = true
        return
      }

      const { audio, state } = await clip.tick(timeUs)

      // Check stopped flag immediately after async operation
      if (stopped)
        return

      // Stop when audio file ends (don't loop)
      if (state === 'done') {
        stopped = true
        return
      }
      const len = audio?.[0]?.length ?? 0
      if (len === 0) {
        // No audio data - either at silence or past end of file
        // Stop playing to avoid infinite loop
        stopped = true
        return
      }
      // Let the browser handle playback-rate resampling for better audio quality.
      startAt = this.playFrames(audio as Float32Array[], sampleRate, startAt, gainNode, sources, playRate)

      // Check stopped before recursing
      if (!stopped) {
        // Use setTimeout to avoid deep call stack and allow stop to interrupt
        setTimeout(() => play(), 0)
      }
    }

    play()
    return {
      sources,
      stop: () => {
        stopped = true
      },
      // Treat loop as active while there are still scheduled sources playing.
      isStopped: () => stopped && sources.length === 0,
    }
  }

  private playFrames(
    audio: Float32Array[],
    sampleRate: number,
    startAt: number,
    gainNode: GainNode,
    sources?: AudioBufferSourceNode[],
    playbackRate: number = 1,
  ) {
    const channels = Math.max(audio.length, 1)
    const len = audio[0]?.length ?? 0
    if (len === 0)
      return startAt
    const buffer = this.ctx.createBuffer(channels, len, sampleRate)
    for (let i = 0; i < channels; i++) {
      const data = audio[i] ?? new Float32Array(len)
      buffer.copyToChannel(new Float32Array(data), i)
    }
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const safePlaybackRate = Math.max(0.1, playbackRate)
    source.playbackRate.value = safePlaybackRate
    source.connect(gainNode)
    const nextStart = Math.max(this.ctx.currentTime, startAt)
    source.start(nextStart)

    // Track the source so it can be stopped later
    if (sources) {
      sources.push(source)
      // Clean up finished sources after they complete
      const duration = (buffer.duration / safePlaybackRate) * 1000
      setTimeout(() => {
        const index = sources.indexOf(source)
        if (index > -1) {
          sources.splice(index, 1)
        }
      }, duration + 100)
    }

    return nextStart + (buffer.duration / safePlaybackRate)
  }

  private getOrCreateGain(map: Map<string, GainNode>, id: string, volume?: number) {
    const existing = map.get(id)
    if (existing) {
      if (typeof volume === 'number')
        existing.gain.value = this.normalizeVolume(volume)
      return existing
    }
    const gainNode = this.ctx.createGain()
    gainNode.gain.value = this.normalizeVolume(volume)
    gainNode.connect(this.ctx.destination)
    map.set(id, gainNode)
    return gainNode
  }

  private getOrCreateAudioElementState(key: string, segment: IAudioSegment): AudioElementState {
    const existing = this.audioElements.get(key)
    if (existing) {
      if (existing.url !== segment.url) {
        existing.el.pause()
        existing.el.src = segment.url
        existing.el.currentTime = 0
        existing.url = segment.url
        existing.pendingPlay = undefined
        existing.lastTimelineMs = undefined
        existing.lastSourceSec = undefined
        existing.lastSeekTimelineMs = undefined
      }
      return existing
    }

    const el = new Audio(segment.url)
    el.preload = 'auto'
    el.loop = false
    el.volume = this.normalizeVolume(segment.volume)
    el.playbackRate = this.normalizePlayRate(segment.playRate)
    const state: AudioElementState = {
      segmentId: segment.id,
      url: segment.url,
      el,
    }
    this.audioElements.set(key, state)
    return state
  }

  private destroyAudioElement(el: HTMLAudioElement) {
    try {
      el.pause()
    }
    catch (e) {
      // Ignore media element pause failures.
    }
    el.removeAttribute('src')
    try {
      el.load()
    }
    catch (e) {
      // Ignore load failures during teardown.
    }
  }

  private normalizePlayRate(playRate?: number): number {
    if (typeof playRate !== 'number' || !Number.isFinite(playRate))
      return 1
    return Math.max(0.1, Math.min(100, playRate))
  }

  private normalizeVolume(volume?: number): number {
    if (typeof volume !== 'number' || !Number.isFinite(volume))
      return 1
    return Math.max(0, Math.min(1, volume))
  }

  private computeSegmentVolume(segment: IAudioSegment, relativeMs: number): number {
    const baseVolume = this.normalizeVolume(segment.volume)
    const segmentDuration = Math.max(0, segment.endTime - segment.startTime)
    const fadeInDuration = Math.max(0, segment.fadeInDuration ?? 0)
    const fadeOutDuration = Math.max(0, segment.fadeOutDuration ?? 0)

    let volumeMultiplier = 1

    // Apply fade in
    if (fadeInDuration > 0 && relativeMs < fadeInDuration) {
      volumeMultiplier = Math.max(0, relativeMs / fadeInDuration)
    }

    // Apply fade out
    const timeUntilEnd = segmentDuration - relativeMs
    if (fadeOutDuration > 0 && timeUntilEnd < fadeOutDuration) {
      volumeMultiplier = Math.min(volumeMultiplier, Math.max(0, timeUntilEnd / fadeOutDuration))
    }

    return baseVolume * volumeMultiplier
  }

  private audioKey(id: string) {
    return `audio:${id}`
  }

  private videoKey(id: string) {
    return `video:${id}`
  }

  private async loadClip(segment: IAudioSegment): Promise<ClipEntry | undefined> {
    // Check if already loaded
    const cached = this.clips.get(segment.id)
    if (cached)
      return cached

    // Check if currently loading
    const loading = this.loadingClips.get(segment.id)
    if (loading)
      return loading

    // Start loading and cache the promise immediately
    const loadingPromise = (async () => {
      try {
        const response = await fetch(segment.url)
        if (!response.body) {
          this.loadingClips.delete(segment.id)
          return undefined
        }
        const clip = new WebAVAudioClip(response.body)
        const entry: ClipEntry = { clip, ready: clip.ready }
        await clip.ready
        if (!this.findSegmentInProtocol(segment.id)) {
          clip.destroy()
          this.loadingClips.delete(segment.id)
          return undefined
        }
        // Move from loading to loaded
        this.clips.set(segment.id, entry)
        this.loadingClips.delete(segment.id)
        return entry
      }
      catch (e) {
        console.error(`[AudioManager] Failed to load audio ${segment.url}`, e)
        this.loadingClips.delete(segment.id)
        return undefined
      }
    })()

    this.loadingClips.set(segment.id, loadingPromise)
    return loadingPromise
  }

  private findSegmentInProtocol(id: string): boolean {
    for (const track of this.protocol.tracks) {
      for (const segment of track.children) {
        if (segment.id === id) return true
      }
    }
    return false
  }

  private getSegmentVolume(id: string): number {
    for (const track of this.protocol.tracks) {
      for (const segment of track.children) {
        if (segment.id !== id)
          continue
        const volume = (segment as { volume?: number }).volume
        return this.normalizeVolume(volume)
      }
    }
    return 1
  }

  private getClipSampleRate(clip: AudioClip | MP4Clip): number {
    const meta = (clip as { meta?: Record<string, unknown> }).meta
    if (!meta)
      return 48000
    const audioSampleRate = meta.audioSampleRate
    if (typeof audioSampleRate === 'number' && audioSampleRate > 0)
      return audioSampleRate
    const sampleRate = meta.sampleRate
    if (typeof sampleRate === 'number' && sampleRate > 0)
      return sampleRate
    return 48000
  }
}
