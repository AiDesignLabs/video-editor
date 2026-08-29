import type { IVideoFramesSegment } from '@video-editor/shared'

export interface VideoThumbnailRequest {
  url: string
  startTime: number
  endTime: number
  fromTime: number
  playRate: number
}

export interface VideoThumbnailOptions {
  start: number
  end: number
  step: number
}

export type VideoThumbnailExtractionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type VideoThumbnailExtractionStage = 'idle' | 'metadata' | 'extracting' | 'complete'

export interface VideoThumbnailExtractionDiagnostics {
  error: string | null
  errorName?: string
  errorStack?: string
  extractionDurationMs?: number
  metadataDurationMs?: number
  requestedEndUs?: number
  requestedStartUs?: number
  requestedStepUs?: number
  requestId: number
  resultCount: number
  sourceDurationMs?: number
  stage: VideoThumbnailExtractionStage
  status: VideoThumbnailExtractionStatus
  totalDurationMs?: number
}

const TARGET_THUMBNAIL_COUNT = 8
const MIN_THUMBNAIL_STEP_US = 200_000

export function createVideoThumbnailExtractionDiagnostics(): VideoThumbnailExtractionDiagnostics {
  return {
    error: null,
    requestId: 0,
    resultCount: 0,
    stage: 'idle',
    status: 'idle',
  }
}

export const videoThumbnailExtractionModel = {
  createRequest(segment: IVideoFramesSegment): VideoThumbnailRequest {
    return {
      url: segment.url,
      startTime: segment.startTime,
      endTime: segment.endTime,
      fromTime: segment.fromTime ?? 0,
      playRate: segment.playRate ?? 1,
    }
  },

  resolveOptions(request: VideoThumbnailRequest, sourceDurationUs: number): VideoThumbnailOptions {
    const startUs = Math.max(request.fromTime, 0) * 1000
    const timelineDurationMs = Math.max(request.endTime - request.startTime, 1)
    const requestedEndUs = startUs + timelineDurationMs * Math.max(request.playRate, 0.0001) * 1000
    const lastSourceTimeUs = sourceDurationUs > 0 ? Math.max(sourceDurationUs - 1, 0) : requestedEndUs
    const endUs = Math.max(startUs, Math.min(requestedEndUs, lastSourceTimeUs))
    const stepUs = Math.max(Math.floor((endUs - startUs) / TARGET_THUMBNAIL_COUNT), MIN_THUMBNAIL_STEP_US)

    return { start: startUs, end: endUs, step: stepUs }
  },
}
