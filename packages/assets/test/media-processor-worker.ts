/// <reference lib="webworker" />

import type { MediaProcessor } from '../src/renditions/media-processor'
import { attachMediaProcessorWorker } from '../src/media-worker'

const processor: MediaProcessor = {
  async process(request) {
    request.onProgress?.({ framesDone: 1, framesTotal: 2, ratio: 0.5, elapsedMs: 5 })
    return request.profiles.map((profile, index) => ({
      profileId: profile.id,
      file: new File([`rendition-${index}`], `${profile.id}.mp4`, { type: 'video/mp4' }),
      width: index === 0 ? 1280 : 640,
      height: index === 0 ? 720 : 360,
    }))
  },
}

attachMediaProcessorWorker(globalThis as unknown as DedicatedWorkerGlobalScope, processor)
