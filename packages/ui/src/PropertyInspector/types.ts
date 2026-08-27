import type { SegmentUnion } from '@video-editor/shared'

/**
 * Mutation callback forwarded by the host to its protocol manager
 * (e.g. editor-core `commands.updateSegment(updater, id, type)`).
 */
export type SegmentUpdater = (draft: SegmentUnion) => void
