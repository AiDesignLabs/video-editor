export const TYPE_ERROR_PREFIX = 'data must be'
export const POSITIVE_NUMBER_SUFFIX = 'must be >= 0'

export const INVALID_START_TIME = `startTime ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_END_TIME = `endTime ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_ID = 'id must be a string'
export const INVALID_URL = 'url must be a string and a valid uri'

export const INVALID_RGBA = 'must be a string and a valid rgba color'

export function generateMissingRequiredReg(attr: string[] | string, opts?: {
  path?: string
  match?: 'all' | 'start' | 'end'
}): RegExp {
  const { path = '', match = 'all' } = opts ?? {}
  // match "data must have required property 'height', data must have required property 'fps'"
  const content = `(data${path} must have required property '(${Array.isArray(attr) ? attr.join('|') : attr})'(,\\s*)?)+`
  const map = {
    all: `^${content}$`,
    start: `^${content}`,
    end: `${content}$`,
  }
  return new RegExp(map[match])
}

export function generateTypeErrorPrefixReg(path?: string[] | string, suffix = 'object'): RegExp {
  // match "data/transform must be object"
  return new RegExp(`(data${path ? Array.isArray(path) ? path.join('|') : path : ''} must be ${suffix}(,\\s*)?)+`)
}
