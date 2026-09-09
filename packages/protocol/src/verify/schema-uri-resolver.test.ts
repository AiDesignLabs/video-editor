import { describe, expect, it } from 'vitest'
import { schemaUriResolver } from './schema-uri-resolver'

describe('schema URI resolver', () => {
  it('resolves local fragments against the current schema', () => {
    expect(schemaUriResolver.resolve(
      'http://json-schema.org/draft-07/schema',
      '#/definitions/nonNegativeInteger',
    )).toBe('http://json-schema.org/draft-07/schema#/definitions/nonNegativeInteger')
  })

  it('round-trips absolute schema references and fragments', () => {
    const uri = 'http://json-schema.org/draft-07/schema#/definitions/nonNegativeInteger'

    expect(schemaUriResolver.serialize(schemaUriResolver.parse(uri))).toBe(uri)
  })

  it('keeps absolute references and rejects unsupported relative schema files', () => {
    expect(schemaUriResolver.resolve('', 'http://json-schema.org/schema')).toBe('http://json-schema.org/schema')
    expect(() => schemaUriResolver.resolve('', 'other-schema.json')).toThrow(
      'Unsupported relative JSON Schema reference: other-schema.json',
    )
  })
})
