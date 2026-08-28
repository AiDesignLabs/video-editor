import type { ComposeProtocolOptions } from '@video-editor/renderer'

export type ExportFormat = 'mp4' | 'webm'
export type ExportCodec = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1'

/** Codecs each container accepts, mirroring the encoder support table. */
export const CODECS_BY_FORMAT: Record<ExportFormat, readonly ExportCodec[]> = {
  mp4: ['avc', 'hevc', 'vp9', 'av1'],
  webm: ['vp8', 'vp9', 'av1'],
}

export const DEFAULT_CODEC: Record<ExportFormat, ExportCodec> = {
  mp4: 'avc',
  webm: 'vp9',
}

export interface ExportSettings {
  width: number
  height: number
  fps: number
  format: ExportFormat
  videoCodec: ExportCodec
  /** Target video bitrate in Mbps; `null` leaves the encoder quality preset. */
  videoBitrateMbps: number | null
  /** Target audio bitrate in kbps. */
  audioBitrateKbps: number
  includeAudio: boolean
}

/** Maps the dialog form onto the `composeProtocol` option shape. */
export function toComposeOptions(settings: ExportSettings): ComposeProtocolOptions {
  const options: ComposeProtocolOptions = {
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    format: settings.format,
    videoCodec: settings.videoCodec,
  }

  if (settings.videoBitrateMbps !== null && settings.videoBitrateMbps > 0)
    options.bitrate = Math.round(settings.videoBitrateMbps * 1e6)

  if (!settings.includeAudio)
    options.audio = false
  else if (settings.audioBitrateKbps > 0)
    options.audioBitrate = Math.round(settings.audioBitrateKbps * 1000)

  return options
}
