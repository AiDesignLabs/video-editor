import '@video-editor/shared'

declare module '@video-editor/shared' {
  interface SegmentExtraRegistry {
    frames: {
      aiTag?: string
      confidence?: number
      label?: string
    }
    text: {
      author?: string
    }
  }

  interface TrackExtraRegistry {
    frames: {
      trackOwner?: string
    }
  }

  interface ProtocolExtraRegistry {
    projectName?: string
  }
}
