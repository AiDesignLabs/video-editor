import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('./TimelineTracks.vue', import.meta.url)),
  'utf8',
)

describe('timeline track layout', () => {
  it('lets the track body fill the width left by the sticky rail', () => {
    expect(source).toMatch(/\.ve-track__body\s*\{[\s\S]*?flex:\s*1 1 0%;/)
  })

  it('keeps the segment visible and applies live geometry while resizing', () => {
    expect(source).toContain('v-show="dragPreview?.segment.id !== layout.segment.id"')
    expect(source).not.toContain('resizePreview?.segment.id !== layout.segment.id')
    expect(source).toMatch(/left: `\$\{segmentGeometry\(layout\)\.left\}px`/)
    expect(source).toMatch(/width: `\$\{segmentGeometry\(layout\)\.width\}px`/)
  })

  it('renders only buffered visible segments while preserving active interactions', () => {
    expect(source).toContain('v-for="layout in getRenderedSegments(trackLayout)"')
    expect(source).toContain('if (isActiveSegment(layout))')
    expect(source).toContain('intersectsTimelineRenderWindow(geometry.left, geometry.width, renderWindow)')
  })

  it('keeps a muted track visibly distinct from a hidden track', () => {
    expect(source).toContain('\'ve-track--muted\': trackLayout.track.muted')
    expect(source).toMatch(/\.ve-track--muted \.ve-segment\s*\{[\s\S]*?opacity:\s*0\.5;[\s\S]*?filter:\s*grayscale\(0\.85\);/)
  })
})
