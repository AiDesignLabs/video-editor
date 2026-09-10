/// <reference lib="webworker" />

import type { MediaProcessor } from '../src/renditions/media-processor'
import { attachMediaProcessorWorker } from '../src/media-worker'

const processor: MediaProcessor = {
  async process(request) {
    request.onProgress?.({ renditionId: 'video-h720-v1', renditionRatio: 0.5, completedRenditions: 0, totalRenditions: 1, ratio: 0.5, elapsedMs: 5 })
    return request.profiles.map((profile, index) => ({
      profileId: profile.id,
      file: new File([`rendition-${index}`], `${profile.id}.mp4`, { type: 'video/mp4' }),
      width: index === 0 ? 1280 : 640,
      height: index === 0 ? 720 : 360,
    }))
  },
}

attachMediaProcessorWorker(globalThis as unknown as DedicatedWorkerGlobalScope, processor)
