#!/usr/bin/env node
import { execSync } from 'node:child_process'

const dependencyKeys = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

function readTree() {
  const output = execSync('pnpm list --depth Infinity --json @vue/reactivity', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const data = JSON.parse(output)
  return Array.isArray(data) ? data : [data]
}

function collectVersions(roots) {
  const versions = new Map()

  const record = (version, location) => {
    if (!versions.has(version))
      versions.set(version, new Set())
    if (location)
      versions.get(version).add(location)
  }

  const visit = (node, trail = []) => {
    if (!node || typeof node !== 'object')
      return

    for (const key of dependencyKeys) {
      const deps = node[key]
      if (!deps || typeof deps !== 'object')
        continue
      for (const [name, dep] of Object.entries(deps)) {
        const nextTrail = [...trail, name]
        if (name === '@vue/reactivity') {
          const version = dep?.version || dep?.from || 'unknown'
          const location = dep?.path || nextTrail.join(' > ')
          record(version, location)
        }
        visit(dep, nextTrail)
      }
    }
  }

  roots.forEach(root => visit(root))

  return versions
}

function formatVersions(versions) {
  return [...versions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([version, locations]) => {
      const list = [...locations].sort().join(', ')
      return `${version}${list ? ` (${list})` : ''}`
    })
    .join('\n')
}

try {
  const roots = readTree()
  const versions = collectVersions(roots)
  const versionCount = versions.size

  if (versionCount === 0) {
    console.warn('[reactivity-check] @vue/reactivity not found in dependency tree.')
    process.exit(1)
  }

  if (versionCount > 1) {
    console.error('[reactivity-check] multiple @vue/reactivity versions detected:')
    console.error(formatVersions(versions))
    process.exit(1)
  }

  const [[version]] = versions.entries()
  console.log(`[reactivity-check] ok: single @vue/reactivity version (${version}).`)
}
catch (error) {
  console.error('[reactivity-check] failed to inspect dependency tree.')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
