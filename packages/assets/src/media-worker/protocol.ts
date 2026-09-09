import type { TranscodeProgress } from '@video-editor/media'
import type { ProcessedRendition } from '../renditions/media-processor'
import type { VideoRenditionProfile } from '../types'

export type MediaProcessorWorkerRequest
  = | {
    type: 'process'
    requestId: string
    source: File
    profiles: readonly VideoRenditionProfile[]
    reportProgress: boolean
  }
  | {
    type: 'cancel'
    requestId: string
  }

export type MediaProcessorWorkerResponse
  = | {
    type: 'progress'
    requestId: string
    progress: TranscodeProgress
  }
  | {
    type: 'result'
    requestId: string
    renditions: readonly ProcessedRendition[]
  }
  | {
    type: 'error'
    requestId: string
    error: {
      name: string
      message: string
    }
  }
