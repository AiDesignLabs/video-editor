/**
 * Extract waveform peaks from audio for visualization
 */

import { file as _file } from 'opfs-tools'
import { getResourceKey, getResourceOpfsPath } from './key'
import { DEFAULT_RESOURCE_DIR } from './constants'

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
}

// In-memory cache for waveform data
const waveformCache = new Map<string, WaveformData>()

/**
 * Get cache key for waveform data
 */
function getCacheKey(url: string, samples: number): string {
  return `${getResourceKey(url)}:${samples}`
}

/**
 * Extract waveform peaks from an audio URL
 * Will try to read from OPFS cache first, then fall back to fetch
 */
export async function extractWaveform(
  url: string,
  options: WaveformOptions = {},
): Promise<WaveformData> {
  const { samples = 100, channel = 'mix', resourceDir = DEFAULT_RESOURCE_DIR } = options
  const cacheKey = getCacheKey(url, samples)

  // Check memory cache first
  const cached = waveformCache.get(cacheKey)
  if (cached)
    return cached

  // Try to get audio data from OPFS cache or fetch
  const arrayBuffer = await getAudioArrayBuffer(url, resourceDir)

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
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
}

/**
 * Extract waveform from an ArrayBuffer directly (no fetch needed)
 */
export async function extractWaveformFromBuffer(
  arrayBuffer: ArrayBuffer,
  cacheKey: string,
  options: Omit<WaveformOptions, 'resourceDir'> = {},
): Promise<WaveformData> {
  const { samples = 100, channel = 'mix' } = options
  const fullCacheKey = `${cacheKey}:${samples}`

  // Check memory cache first
  const cached = waveformCache.get(fullCacheKey)
  if (cached)
    return cached

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
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
}

/**
 * Clear waveform cache for a specific URL or all
 */
export function clearWaveformCache(url?: string): void {
  if (url) {
    const keyPrefix = getResourceKey(url)
    for (const key of waveformCache.keys()) {
      if (key.startsWith(keyPrefix))
        waveformCache.delete(key)
    }
  }
  else {
    waveformCache.clear()
  }
}

/**
 * Get audio data from OPFS cache or fetch from network
 */
async function getAudioArrayBuffer(url: string, resourceDir: string): Promise<ArrayBuffer> {
  // Try OPFS cache first
  const opfsPath = getResourceOpfsPath(resourceDir, url)
  if (opfsPath) {
    try {
      const file = _file(opfsPath)
      if (await file.exists()) {
        const originFile = await file.getOriginFile()
        if (originFile) {
          return await originFile.arrayBuffer()
        }
      }
    }
    catch {
      // OPFS read failed, fall back to fetch
    }
  }

  // Fall back to fetch
  const response = await fetch(url)
  return await response.arrayBuffer()
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
    return new Array(samples).fill(0)
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
