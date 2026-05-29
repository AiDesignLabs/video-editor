import type { IAudioSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import type { AudioPlanEvent, TimelinePlan } from './timeline'
interface Mp4State {
  sources: AudioBufferSourceNode[]
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

type VoicePhase = 'idle' | 'playing' | 'ended'

interface PlannedVoiceRuntime {
  phase: VoicePhase
  segmentKind: 'audio' | 'video'
  lastSourceSec?: number
  lastGain?: number
  lastRate?: number
}

type AudioElementSegment = IAudioSegment | IVideoFramesSegment

interface AudioManagerOptions {
  resolveMediaElementUrl?: (segment: AudioElementSegment) => string | undefined
}

export class AudioManager {
  private protocol: IVideoProtocol
  private options: AudioManagerOptions
  private mp4States = new Map<string, Mp4State>()
  private mp4Gains = new Map<string, GainNode>()
  private plannedVideoAudioGains = new Map<string, number>()
  private plannedVideoAudioRates = new Map<string, number>()
  private plannedVoices = new Map<string, PlannedVoiceRuntime>()
  private audioElements = new Map<string, AudioElementState>()
  private ctx: AudioContext

  constructor(protocol: IVideoProtocol, options: AudioManagerOptions = {}) {
    this.protocol = protocol
    this.options = options
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }

  public setProtocol(protocol: IVideoProtocol) {
    this.protocol = protocol
  }

  public applyTimelinePlan(
    plan: TimelinePlan,
    isPlaying: boolean,
  ) {
    if (!isPlaying) {
      this.stopAll()
      return
    }

    if (this.ctx.state === 'suspended')
      this.ctx.resume().catch(() => {})

    for (const event of plan.audioEvents)
      this.applyAudioPlanEvent(event)
  }

  public resetTimelineState(options: { stop?: boolean } = {}) {
    this.plannedVoices.clear()
    this.plannedVideoAudioGains.clear()
    this.plannedVideoAudioRates.clear()
    if (options.stop)
      this.stopAll()
  }

  /**
   * Play audio frames from MP4 video directly.
   * Called by renderer after it gets audio data from clip.tick()
   */
  public playMp4AudioFrames(id: string, audio: Float32Array[] | Float32Array | undefined, sampleRate: number) {
    const pcmChannels = this.normalizePcmChannels(audio)
    if (!pcmChannels)
      return

    const key = this.videoKey(id)
    const plannedVolume = this.plannedVideoAudioGains.get(key)
    const volume = typeof plannedVolume === 'number'
      ? this.normalizeVolume(plannedVolume)
      : this.getSegmentVolume(id)
    const plannedRate = this.plannedVideoAudioRates.get(key)
    const playbackRate = typeof plannedRate === 'number'
      ? this.normalizePlayRate(plannedRate)
      : 1
    const gainNode = this.getOrCreateGain(this.mp4Gains, key, volume)

    if (this.ctx.state === 'suspended')
      this.ctx.resume().catch(() => {})

    // Get or initialize the playback state for this video
    let state = this.mp4States.get(key)
    if (!state) {
      state = {
        sources: [],
        nextStartAt: 0,
      }
      this.mp4States.set(key, state)
    }

    // Play the audio frames
    state.nextStartAt = this.playFrames(
      pcmChannels,
      this.normalizeSampleRate(sampleRate),
      state.nextStartAt ?? 0,
      gainNode,
      state.sources,
      playbackRate,
    )
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
      // Stop all audio buffer sources
      for (const source of state.sources) {
        try {
          source.stop()
          source.disconnect()
        }
        catch (e) {
          // Source may already be stopped or disconnected
        }
      }
      state.sources.length = 0
      this.mp4States.delete(key)
      this.mp4Gains.delete(key)
    }
  }

  public destroy() {
    this.stopAll()
    for (const state of this.audioElements.values())
      this.destroyAudioElement(state.el)
    this.audioElements.clear()
  }

  private stopAll() {
    for (const state of this.audioElements.values()) {
      this.pauseAudioElementState(state)
    }

    for (const state of this.mp4States.values()) {
      for (const source of state.sources) {
        try {
          source.stop(0)
          source.disconnect()
        }
        catch (e) {
          // Source may already be stopped or disconnected
        }
      }
      state.sources.length = 0
    }
    // Disconnect all gain nodes to completely silence audio
    for (const gain of this.mp4Gains.values()) {
      try {
        gain.disconnect()
      }
      catch (e) {
        // Gain may already be disconnected
      }
    }
    this.mp4States.clear()
    this.mp4Gains.clear()
    this.plannedVoices.clear()
    this.plannedVideoAudioGains.clear()
    this.plannedVideoAudioRates.clear()
  }

  private applyAudioPlanEvent(event: AudioPlanEvent) {
    if (event.segmentKind === 'audio') {
      this.applySegmentAudioEvent(event)
      return
    }
    this.applyVideoAudioEvent(event)
  }

  private applySegmentAudioEvent(event: AudioPlanEvent) {
    const key = this.audioKey(event.segmentId)
    const voice = this.getOrCreatePlannedVoice(event)

    if (event.action === 'stop') {
      const state = this.audioElements.get(key)
      if (!state) {
        this.plannedVoices.delete(event.voiceId)
        return
      }
      this.pauseAudioElementState(state)
      voice.phase = 'ended'
      this.plannedVoices.delete(event.voiceId)
      return
    }

    const segment = this.findAudioSegment(event.segmentId)
    if (!segment)
      return
    const state = this.getOrCreateAudioElementState(key, segment)

    if (event.action === 'start' || event.action === 'seek') {
      const sourceOffsetMs = this.computeSegmentSourceOffsetMs(
        segment,
        event.atTimelineMs,
        event.sourceTimeMs,
      )
      const { targetSourceSec, isSourceExhausted } = this.resolveAudioElementSourceWindow(
        state,
        segment,
        sourceOffsetMs,
      )
      if (isSourceExhausted) {
        this.pauseAudioElementState(state)
        voice.lastSourceSec = targetSourceSec
        voice.phase = 'ended'
        return
      }
      const needsSeek = targetSourceSec !== undefined
        && (voice.phase !== 'playing'
          || voice.lastSourceSec === undefined
          || Math.abs((voice.lastSourceSec ?? 0) - targetSourceSec) > 0.02)
      if (needsSeek) {
        const seekApplied = this.seekAudioElement(state, targetSourceSec, event.atTimelineMs)
        if (!seekApplied && targetSourceSec > 0.05) {
          // Avoid accidental replay from 0 when target seek is not ready yet.
          this.pauseAudioElementState(state)
          voice.phase = 'idle'
          return
        }
      }

      if (typeof event.gain === 'number') {
        const normalizedGain = this.normalizeVolume(event.gain)
        if (voice.lastGain === undefined || Math.abs((voice.lastGain ?? 0) - normalizedGain) > 0.001)
          state.el.volume = normalizedGain
        voice.lastGain = normalizedGain
      }
      if (typeof event.rate === 'number') {
        const normalizedRate = this.normalizePlayRate(event.rate)
        if (voice.lastRate === undefined || Math.abs((voice.lastRate ?? 0) - normalizedRate) > 0.001)
          state.el.playbackRate = normalizedRate
        voice.lastRate = normalizedRate
      }
      if (targetSourceSec !== undefined)
        voice.lastSourceSec = targetSourceSec
      this.playAudioElementState(state)
      voice.phase = 'playing'
      return
    }

    if (event.action === 'gain') {
      if (typeof event.gain === 'number') {
        const normalizedGain = this.normalizeVolume(event.gain)
        if (voice.lastGain === undefined || Math.abs((voice.lastGain ?? 0) - normalizedGain) > 0.001)
          state.el.volume = normalizedGain
        voice.lastGain = normalizedGain
      }
      return
    }

    if (event.action === 'rate' && typeof event.rate === 'number') {
      const normalizedRate = this.normalizePlayRate(event.rate)
      if (voice.lastRate === undefined || Math.abs((voice.lastRate ?? 0) - normalizedRate) > 0.001)
        state.el.playbackRate = normalizedRate
      voice.lastRate = normalizedRate
    }
  }

  private applyVideoAudioEvent(event: AudioPlanEvent) {
    const key = this.videoKey(event.segmentId)
    const voice = this.getOrCreatePlannedVoice(event)
    if (event.action === 'stop') {
      const state = this.audioElements.get(key)
      if (state)
        this.pauseAudioElementState(state)
      this.stopMp4Audio(event.segmentId)
      this.plannedVideoAudioGains.delete(key)
      this.plannedVideoAudioRates.delete(key)
      voice.phase = 'ended'
      this.plannedVoices.delete(event.voiceId)
      return
    }

    const segment = this.findVideoSegment(event.segmentId)
    if (!segment)
      return
    const state = this.getOrCreateAudioElementState(key, segment)

    if (event.action === 'start' || event.action === 'seek') {
      this.stopMp4Audio(event.segmentId)
      const sourceOffsetMs = this.computeSegmentSourceOffsetMs(
        segment,
        event.atTimelineMs,
        event.sourceTimeMs,
      )
      const { targetSourceSec, isSourceExhausted } = this.resolveAudioElementSourceWindow(
        state,
        segment,
        sourceOffsetMs,
      )
      if (isSourceExhausted) {
        this.pauseAudioElementState(state)
        voice.lastSourceSec = targetSourceSec
        voice.phase = 'ended'
        return
      }
      const needsSeek = targetSourceSec !== undefined
        && (voice.phase !== 'playing'
          || event.action === 'seek'
          || voice.lastSourceSec === undefined
          || Math.abs((voice.lastSourceSec ?? 0) - targetSourceSec) > 0.02)
      if (needsSeek) {
        const seekApplied = this.seekAudioElement(state, targetSourceSec, event.atTimelineMs)
        if (!seekApplied && targetSourceSec > 0.05) {
          this.pauseAudioElementState(state)
          voice.phase = 'idle'
          return
        }
      }

      if (typeof event.gain === 'number') {
        const normalizedGain = this.normalizeVolume(event.gain)
        if (voice.lastGain === undefined || Math.abs((voice.lastGain ?? 0) - normalizedGain) > 0.001)
          state.el.volume = normalizedGain
        this.plannedVideoAudioGains.set(key, normalizedGain)
        voice.lastGain = normalizedGain
      }
      if (typeof event.rate === 'number') {
        const normalizedRate = this.normalizePlayRate(event.rate)
        if (voice.lastRate === undefined || Math.abs((voice.lastRate ?? 0) - normalizedRate) > 0.001)
          state.el.playbackRate = normalizedRate
        this.plannedVideoAudioRates.set(key, normalizedRate)
        voice.lastRate = normalizedRate
      }
      if (targetSourceSec !== undefined)
        voice.lastSourceSec = targetSourceSec
      this.playAudioElementState(state)
      voice.phase = 'playing'
    }

    if (typeof event.gain === 'number') {
      const normalizedGain = this.normalizeVolume(event.gain)
      if (voice.lastGain === undefined || Math.abs((voice.lastGain ?? 0) - normalizedGain) > 0.001)
        this.plannedVideoAudioGains.set(key, normalizedGain)
      if (voice.lastGain === undefined || Math.abs((voice.lastGain ?? 0) - normalizedGain) > 0.001)
        state.el.volume = normalizedGain
      const gainNode = this.mp4Gains.get(key)
      if (gainNode)
        gainNode.gain.value = normalizedGain
      voice.lastGain = normalizedGain
    }

    if (typeof event.rate === 'number') {
      const normalizedRate = this.normalizePlayRate(event.rate)
      if (voice.lastRate === undefined || Math.abs((voice.lastRate ?? 0) - normalizedRate) > 0.001)
        this.plannedVideoAudioRates.set(key, normalizedRate)
      if (voice.lastRate === undefined || Math.abs((voice.lastRate ?? 0) - normalizedRate) > 0.001)
        state.el.playbackRate = normalizedRate
      voice.lastRate = normalizedRate
    }
  }

  private getOrCreatePlannedVoice(event: AudioPlanEvent): PlannedVoiceRuntime {
    const existing = this.plannedVoices.get(event.voiceId)
    if (existing)
      return existing
    const runtime: PlannedVoiceRuntime = {
      phase: 'idle',
      segmentKind: event.segmentKind,
    }
    this.plannedVoices.set(event.voiceId, runtime)
    return runtime
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

  private getOrCreateAudioElementState(key: string, segment: AudioElementSegment): AudioElementState {
    const nextUrl = this.options.resolveMediaElementUrl?.(segment) ?? segment.url
    const existing = this.audioElements.get(key)
    if (existing) {
      if (existing.url !== nextUrl) {
        existing.el.pause()
        existing.el.src = nextUrl
        existing.el.currentTime = 0
        existing.url = nextUrl
        existing.pendingPlay = undefined
        existing.lastTimelineMs = undefined
        existing.lastSourceSec = undefined
        existing.lastSeekTimelineMs = undefined
      }
      return existing
    }

    const el = new Audio(nextUrl)
    el.preload = 'auto'
    el.loop = false
    el.volume = this.normalizeVolume(segment.volume)
    el.playbackRate = this.normalizePlayRate(segment.playRate)
    const state: AudioElementState = {
      segmentId: segment.id,
      url: nextUrl,
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

  private playAudioElementState(state: AudioElementState) {
    if (!state.el.paused || state.pendingPlay)
      return
    const maybePromise = state.el.play()
    if (maybePromise && typeof maybePromise.then === 'function') {
      state.pendingPlay = maybePromise
        .catch(() => {})
        .finally(() => {
          state.pendingPlay = undefined
        })
    }
  }

  private pauseAudioElementState(state: AudioElementState) {
    try {
      state.el.pause()
    }
    catch (e) {
      // Ignore media element pause failures.
    }
    state.pendingPlay = undefined
    state.lastTimelineMs = undefined
    state.lastSourceSec = undefined
    state.lastSeekTimelineMs = undefined
  }

  private seekAudioElement(state: AudioElementState, targetSec: number, timelineMs: number): boolean {
    const normalizedTargetSec = Math.max(0, targetSec)
    if (Math.abs(state.el.currentTime - normalizedTargetSec) <= 0.02) {
      state.lastTimelineMs = timelineMs
      state.lastSourceSec = normalizedTargetSec
      return true
    }
    try {
      state.el.currentTime = normalizedTargetSec
      state.lastSeekTimelineMs = timelineMs
      state.lastTimelineMs = timelineMs
      state.lastSourceSec = normalizedTargetSec
      return true
    }
    catch (e) {
      // Metadata not ready or browser rejected out-of-range seek.
      return false
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

  private computeSegmentSourceOffsetMs(
    segment: AudioElementSegment,
    timelineMs: number,
    sourceTimeMs?: number,
  ): number {
    if (typeof sourceTimeMs === 'number' && Number.isFinite(sourceTimeMs))
      return Math.max(0, sourceTimeMs)
    const relativeMs = Math.max(0, timelineMs - segment.startTime)
    const fromTimeMs = Math.max(0, segment.fromTime ?? 0)
    const playRate = this.normalizePlayRate(segment.playRate)
    return Math.max(0, fromTimeMs + relativeMs * playRate)
  }

  private resolveAudioElementSourceWindow(
    state: AudioElementState,
    segment: AudioElementSegment,
    sourceOffsetMs: number,
  ): { targetSourceSec: number, isSourceExhausted: boolean } {
    const playRate = this.normalizePlayRate(segment.playRate)
    const fromTimeMs = Math.max(0, segment.fromTime ?? 0)
    const segmentDurationMs = Math.max(0, segment.endTime - segment.startTime)
    const segmentSourceDurationMs = segmentDurationMs * playRate
    const segmentMaxSourceSec = Math.max(0, fromTimeMs + segmentSourceDurationMs) / 1000
    const mediaDurationSec = Number.isFinite(state.el.duration) ? Math.max(0, state.el.duration) : undefined
    const effectiveMaxSourceSec = mediaDurationSec === undefined
      ? segmentMaxSourceSec
      : Math.min(segmentMaxSourceSec, mediaDurationSec)
    const normalizedSourceSec = Math.max(0, sourceOffsetMs / 1000)
    const targetSourceSec = Math.max(0, Math.min(normalizedSourceSec, effectiveMaxSourceSec))
    const isSourceExhausted = normalizedSourceSec >= (effectiveMaxSourceSec - 0.01)
    return { targetSourceSec, isSourceExhausted }
  }

  private normalizeSampleRate(sampleRate: number): number {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0)
      return 48000
    return Math.round(sampleRate)
  }

  private normalizePcmChannels(
    audio: Float32Array[] | Float32Array | undefined,
  ): Float32Array[] | undefined {
    if (!audio)
      return undefined
    if (audio instanceof Float32Array)
      return audio.length > 0 ? [audio] : undefined
    if (!Array.isArray(audio) || audio.length === 0)
      return undefined

    const channels: Float32Array[] = []
    for (const channel of audio) {
      if (!(channel instanceof Float32Array) || channel.length === 0)
        continue
      channels.push(channel)
    }
    if (channels.length === 0)
      return undefined
    return channels
  }

  private audioKey(id: string) {
    return `audio:${id}`
  }

  private videoKey(id: string) {
    return `video:${id}`
  }

  private findAudioSegment(id: string): IAudioSegment | undefined {
    for (const track of this.protocol.tracks) {
      for (const segment of track.children) {
        if (segment.id === id && segment.segmentType === 'audio')
          return segment as IAudioSegment
      }
    }
    return undefined
  }

  private findVideoSegment(id: string): IVideoFramesSegment | undefined {
    for (const track of this.protocol.tracks) {
      for (const segment of track.children) {
        if (segment.id === id && segment.segmentType === 'frames' && segment.type === 'video')
          return segment as IVideoFramesSegment
      }
    }
    return undefined
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
}
