import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the package against zero-specificity component styles.
 *
 * `:where(...)` drops specificity to 0,0,0 — the same as the universal
 * selector. Every consumer ships a CSS reset (UnoCSS and Tailwind preflight
 * both emit `*, ::before, ::after { margin: 0; padding: 0; border: 0 solid }`),
 * so `:where(.ve-toolbar) { padding: 0 8px }` ties with the reset and loses on
 * source order. The failure is silent: no error, the padding simply disappears.
 *
 * Theming goes through CSS custom properties, not selector weight, so component
 * styles have no reason to zero out their own specificity.
 */
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g

function collectVueFiles(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      collectVueFiles(full, out)
    else if (entry.name.endsWith('.vue'))
      out.push(full)
  }
  return out
}

function whereSelectorsIn(source: string) {
  return [...source.matchAll(STYLE_BLOCK)]
    .flatMap(match => match[1].split('\n'))
    .filter(line => line.includes(':where('))
    .map(line => line.trim())
}

describe('component style specificity', () => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  const files = collectVueFiles(root)

  it('finds the component styles to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('has no :where() in any component style block', () => {
    const offenders = files.flatMap((file) => {
      const hits = whereSelectorsIn(readFileSync(file, 'utf-8'))
      return hits.map(hit => `${file.slice(root.length)}: ${hit}`)
    })

    expect(offenders).toEqual([])
  })
})
