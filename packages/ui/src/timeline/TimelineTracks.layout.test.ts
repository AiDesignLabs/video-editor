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
})
