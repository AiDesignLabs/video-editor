import type { SegmentUnion } from '@video-editor/shared'

/**
 * Mutation callback forwarded by the host to its protocol manager
 * (e.g. editor-core `commands.updateSegment(updater, id, type)`).
 */
export type SegmentUpdater = (draft: SegmentUnion) => void

/**
 * A selectable filter/effect preset.
 *
 * `packages/ui` deliberately does not depend on `@video-editor/renderer`, so the
 * host passes these in — e.g. from the renderer's `listEffectDefinitions()`.
 */
export interface EffectPreset {
  id: string
  label: string
}
