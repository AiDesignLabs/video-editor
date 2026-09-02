/**
 * Extract waveform peaks from audio for visualization
 */

import { getCachedResourceFile } from './cache'
import { DEFAULT_RESOURCE_DIR } from './constants'
import { getResourceKey } from './key'
import { mediaAnalysisPool, throwIfMediaAnalysisAborted } from './media-analysis-pool'

export interface WaveformData {
  peaks: number[] // Normalized peaks between 0 and 1
  duration: number // Duration in seconds
}

export interface WaveformOptions {
  /** Number of samples to extract (default: 100) */
  samples?: number
  /** Channel to use: 0 = left, 1 = right, 'mix' = average (default: 'mix') */
  channel?: number | 'mix'
  /** Resource directory for OPFS cache (default: DEFAULT_RESOURCE_DIR) */
  resourceDir?: string
  /** Stops waiting and removes queued work when no other caller needs it. */
  signal?: AbortSignal
}

// In-memory cache for waveform data
const waveformCache = new Map<string, WaveformData>()

/**
 * Get cache key for waveform data
 */
function getCacheKey(url: string, samples: number, channel: number | 'mix', resourceDir: string): string {
  return `${resourceDir}::${getResourceKey(url)}::${samples}::${channel}`
}

/**
 * Extract waveform peaks from an audio URL
 * Will try to read from OPFS cache first, then fall back to fetch
 */
export async function extractWaveform(
  url: string,
  options: WaveformOptions = {},
): Promise<WaveformData> {
  const { samples = 100, channel = 'mix', resourceDir = DEFAULT_RESOURCE_DIR, signal } = options
  throwIfMediaAnalysisAborted(signal)
  const cacheKey = getCacheKey(url, samples, channel, resourceDir)

  // Check memory cache first
  const cached = waveformCache.get(cacheKey)
  if (cached)
    return cached

  return await mediaAnalysisPool.run(`waveform-url::${cacheKey}`, async (sharedSignal) => {
    // Try to get audio data from OPFS cache or fetch
    const arrayBuffer = await getAudioArrayBuffer(url, resourceDir, sharedSignal)
    throwIfMediaAnalysisAborted(sharedSignal)

    const audioContext = createAudioContext()

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      throwIfMediaAnalysisAborted(sharedSignal)
      const peaks = extractPeaks(audioBuffer, samples, channel)

      const result: WaveformData = {
        peaks,
        duration: audioBuffer.duration,
      }

      // Cache the result
      waveformCache.set(cacheKey, result)

      return result
    }
    finally {
      await audioContext.close()
    }
  }, signal)
}

/**
 * Extract waveform from an ArrayBuffer directly (no fetch needed)
 */
export async function extractWaveformFromBuffer(
  arrayBuffer: ArrayBuffer,
  cacheKey: string,
  options: Omit<WaveformOptions, 'resourceDir'> = {},
): Promise<WaveformData> {
  const { samples = 100, channel = 'mix', signal } = options
  throwIfMediaAnalysisAborted(signal)
  const fullCacheKey = `${cacheKey}:${samples}:${channel}`

  // Check memory cache first
  const cached = waveformCache.get(fullCacheKey)
  if (cached)
    return cached

  return await mediaAnalysisPool.run(`waveform-buffer::${fullCacheKey}`, async (sharedSignal) => {
    const audioContext = createAudioContext()

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
      throwIfMediaAnalysisAborted(sharedSignal)
      const peaks = extractPeaks(audioBuffer, samples, channel)

      const result: WaveformData = {
        peaks,
        duration: audioBuffer.duration,
      }

      // Cache the result
      waveformCache.set(fullCacheKey, result)

      return result
    }
    finally {
      await audioContext.close()
    }
  }, signal)
}

/**
 * Clear waveform cache for a specific URL or all
 */
export function clearWaveformCache(url?: string, resourceDir?: string): void {
  if (url) {
    const resourceKey = getResourceKey(url)
    mediaAnalysisPool.cancelMatching((key) => {
      if (!key.startsWith('waveform-url::'))
        return false
      const [, cachedDir, cachedResourceKey] = key.split('::')
      return cachedResourceKey === resourceKey && (resourceDir === undefined || cachedDir === resourceDir)
    })
    for (const key of waveformCache.keys()) {
      const [cachedDir, cachedResourceKey] = key.split('::')
      if (cachedResourceKey === resourceKey && (resourceDir === undefined || cachedDir === resourceDir))
        waveformCache.delete(key)
    }
  }
  else {
    mediaAnalysisPool.cancelMatching(key => key.startsWith('waveform-'))
    waveformCache.clear()
  }
}

/**
 * Get audio data from OPFS cache or fetch from network
 */
async function getAudioArrayBuffer(url: string, resourceDir: string, signal: AbortSignal): Promise<ArrayBuffer> {
  // Try OPFS cache first
  const file = await getCachedResourceFile(url, resourceDir)
  if (file) {
    const originFile = await file.getOriginFile()
    if (originFile) {
      const buffer = await originFile.arrayBuffer()
      throwIfMediaAnalysisAborted(signal)
      return buffer
    }
  }

  // Fall back to fetch
  throwIfMediaAnalysisAborted(signal)
  const response = await fetch(url, { signal })
  return await response.arrayBuffer()
}

function createAudioContext() {
  const legacyWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext
  }
  const AudioContextConstructor = window.AudioContext ?? legacyWindow.webkitAudioContext
  if (!AudioContextConstructor)
    throw new Error('Web Audio API is not supported')
  return new AudioContextConstructor()
}

/**
 * Extract peaks from AudioBuffer
 */
function extractPeaks(
  audioBuffer: AudioBuffer,
  samples: number,
  channel: number | 'mix',
): number[] {
  const channelCount = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  const samplesPerPeak = Math.floor(length / samples)

  if (samplesPerPeak === 0) {
    // Audio is too short, return empty peaks
    return Array.from({ length: samples }, () => 0)
  }

  const peaks: number[] = []

  for (let i = 0; i < samples; i++) {
    const start = i * samplesPerPeak
    const end = Math.min(start + samplesPerPeak, length)

    let maxPeak = 0

    if (channel === 'mix') {
      // Mix all channels
      for (let ch = 0; ch < channelCount; ch++) {
        const channelData = audioBuffer.getChannelData(ch)
        for (let j = start; j < end; j++) {
          const abs = Math.abs(channelData[j])
          if (abs > maxPeak)
            maxPeak = abs
        }
      }
    }
    else {
      // Use specific channel
      const ch = Math.min(channel, channelCount - 1)
      const channelData = audioBuffer.getChannelData(ch)
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j])
        if (abs > maxPeak)
          maxPeak = abs
      }
    }

    peaks.push(maxPeak)
  }

  // Normalize peaks to 0-1 range
  const maxValue = Math.max(...peaks, 0.001) // Avoid division by zero
  return peaks.map(p => p / maxValue)
}

/**
 * Create a simple waveform SVG path from peaks
 */
export function peaksToSvgPath(peaks: number[], width: number, height: number): string {
  if (peaks.length === 0)
    return ''

  const barWidth = width / peaks.length
  const centerY = height / 2
  const paths: string[] = []

  for (let i = 0; i < peaks.length; i++) {
    const x = i * barWidth + barWidth / 2
    const peakHeight = peaks[i] * (height * 0.8) // 80% of height max
    const y1 = centerY - peakHeight / 2
    const y2 = centerY + peakHeight / 2

    // Draw vertical line for each peak
    paths.push(`M${x},${y1}L${x},${y2}`)
  }

  return paths.join(' ')
}

/**
 * Generate waveform bars data for canvas/div rendering
 */
export function peaksToBars(peaks: number[], containerWidth: number): Array<{ x: number, height: number }> {
  if (peaks.length === 0)
    return []

  const barWidth = containerWidth / peaks.length

  return peaks.map((peak, i) => ({
    x: i * barWidth,
    height: peak,
  }))
}
