export interface AudioData {
  numberOfChannels: number
  numberOfFrames: number
  sampleRate: number
  copyTo(destination: ArrayBuffer | ArrayBufferView, options: { planeIndex: number }): void
  close(): void
}

export type AudioFrames = {
  frames: Float32Array<ArrayBufferLike>[]
  sampleRate: number
}

export type AudioChunk = AudioData | AudioData[] | AudioFrames | Float32Array<ArrayBufferLike>[]

export class AudioFramePlayer {
  private ctx: AudioContext
  private nextStartTime: number = 0
  private runningNodes: AudioBufferSourceNode[] = []

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  }

  public async play(audioChunk: AudioChunk) {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    if (this.isAudioFrames(audioChunk)) {
      this.scheduleBuffer(this.framesToBuffer(audioChunk.frames, audioChunk.sampleRate))
      return
    }

    if (Array.isArray(audioChunk) && this.isFrameArray(audioChunk)) {
      this.scheduleBuffer(this.framesToBuffer(audioChunk, this.ctx.sampleRate))
      return
    }

    const audioData = Array.isArray(audioChunk) ? audioChunk : [audioChunk]
    if (!audioData.length) return

    for (const data of audioData) {
      this.scheduleBuffer(this.toAudioBuffer(data))
      try {
        data.close()
      } catch (err) {
        console.warn('[AudioFramePlayer] close audio data failed', err)
      }
    }
  }

  public async reset() {
    this.runningNodes.forEach(node => {
      try {
        node.stop()
      } catch (err) {
        console.warn('[AudioFramePlayer] stop node failed', err)
      }
    })
    this.runningNodes = []

    await this.ctx.close()
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    this.nextStartTime = 0
  }
  
  private scheduleBuffer(buffer: AudioBuffer) {
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    source.onended = () => {
      const index = this.runningNodes.indexOf(source)
      if (index > -1) this.runningNodes.splice(index, 1)
    }

    if (this.nextStartTime < this.ctx.currentTime) {
      this.nextStartTime = this.ctx.currentTime
    }

    source.start(this.nextStartTime)
    this.runningNodes.push(source)

    this.nextStartTime += buffer.duration
  }

  private toAudioBuffer(data: AudioData): AudioBuffer {
    const buffer = this.ctx.createBuffer(
      data.numberOfChannels,
      data.numberOfFrames,
      data.sampleRate
    )

    for (let ch = 0; ch < data.numberOfChannels; ch++) {
      const channelData = new Float32Array(data.numberOfFrames)
      data.copyTo(channelData, { planeIndex: ch })
      buffer.copyToChannel(channelData, ch)
    }

    return buffer
  }

  private framesToBuffer(frames: Float32Array<ArrayBufferLike>[], sampleRate: number): AudioBuffer {
    const channels = Math.max(frames.length, 1)
    const length = frames[0]?.length ?? 0
    const buffer = this.ctx.createBuffer(channels, length, sampleRate)
    for (let ch = 0; ch < channels; ch++) {
      const data = frames[ch] ?? new Float32Array(length)
      buffer.copyToChannel(new Float32Array(data), ch)
    }
    return buffer
  }

  private isAudioFrames(chunk: AudioChunk): chunk is AudioFrames {
    return typeof chunk === 'object'
      && !Array.isArray(chunk)
      && 'frames' in chunk
      && 'sampleRate' in chunk
  }

  private isFrameArray(frames: unknown[]): frames is Float32Array<ArrayBufferLike>[] {
    const first = frames[0]
    return first instanceof Float32Array
  }
}
