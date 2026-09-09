import type { Options } from 'ajv'

const ABSOLUTE_URI_RE = /^[a-z][a-z\d+.-]*:/i

function splitFragment(uri: string) {
  const fragmentIndex = uri.indexOf('#')

  if (fragmentIndex === -1)
    return { path: uri }

  return {
    path: uri.slice(0, fragmentIndex),
    fragment: uri.slice(fragmentIndex + 1),
  }
}

function removeFragment(uri: string) {
  return splitFragment(uri).path
}

// Protocol schemas only use local fragments. Keeping this resolver local avoids
// relying on a transformed transitive URI parser in browser development builds.
export const schemaUriResolver: NonNullable<Options['uriResolver']> = {
  parse: splitFragment,
  resolve(base, reference) {
    if (reference === '')
      return base

    if (reference.startsWith('#'))
      return `${removeFragment(base)}${reference}`

    if (ABSOLUTE_URI_RE.test(reference))
      return reference

    throw new Error(`Unsupported relative JSON Schema reference: ${reference}`)
  },
  serialize({ path = '', fragment }) {
    return fragment === undefined ? path : `${path}#${fragment}`
  },
}
