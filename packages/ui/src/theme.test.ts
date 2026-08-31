import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const theme = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8')

/**
 * The token layer is written once per token with `light-dark()`, so the whole
 * theme hinges on one thing: whether `color-scheme` is dark on an ancestor.
 * A host that flips themes with a class and never sets `color-scheme` — the
 * default for Tailwind and @nuxtjs/color-mode, and how creatly-fe2 does it —
 * would otherwise get a timeline that follows the OS while its page is dark.
 */
describe('theme color-scheme hooks', () => {
  const schemeBlocks = [...theme.matchAll(/([^{}]+)\{[^;{}]*color-scheme:([^;]*);/g)]
    .map(match => ({ selectors: match[1].trim(), value: match[2].trim() }))

  function selectorsFor(value: string) {
    return schemeBlocks
      .filter(block => block.value === value)
      .flatMap(block => block.selectors.split(',').map(s => s.trim().split('\n').pop()!.trim()))
  }

  it('follows the OS by default', () => {
    expect(selectorsFor('light dark')).toContain(':root')
  })

  it('honours a host class-based theme switch in both directions', () => {
    expect(selectorsFor('dark')).toContain('html.dark')
    expect(selectorsFor('light')).toContain('html.light')
  })

  it('lets a subtree be themed without touching the document', () => {
    expect(selectorsFor('dark')).toEqual(expect.arrayContaining(['[data-theme=\'dark\']', '.ve-theme-dark']))
    expect(selectorsFor('light')).toEqual(expect.arrayContaining(['[data-theme=\'light\']', '.ve-theme-light']))
  })

  it('declares every colour token for both themes', () => {
    // A bare colour is light-only unless something redeclares it per theme, and
    // nothing here does — so each one must say out loud that it is deliberate,
    // e.g. white text that sits on a dark scrim in either theme.
    const offenders = [...theme.matchAll(/^[ \t]*(--ve-[\w-]+):[ \t]*(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))[ \t]*;(.*)$/gim)]
      .filter(match => !match[2].includes('both-themes'))
      .map(match => match[1])
    expect(offenders).toEqual([])
  })
})
