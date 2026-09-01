export const TYPE_ERROR_PREFIX = 'data must be'
export const POSITIVE_NUMBER_SUFFIX = 'must be >= 0'

/**
 * Canvas bounds live here rather than next to `setCanvasSize` so that the
 * schema is the single source of truth: a protocol written directly, without
 * going through a command, must not be able to describe a canvas no encoder
 * can produce.
 */
/** Smallest canvas a codec will accept; 0 used to pass the schema but encodes nothing. */
export const MIN_CANVAS_SIZE = 2
/** Guards against absurd values that would allocate an unusable render target. */
export const MAX_CANVAS_SIZE = 8192
export const CANVAS_SIZE_SUFFIX = `must be a whole number of pixels between ${MIN_CANVAS_SIZE} and ${MAX_CANVAS_SIZE}`

export const INVALID_START_TIME = `startTime ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_END_TIME = `endTime ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_ID = 'id must be a string'
export const INVALID_URL = 'url must be a string and a valid uri'

export const INVALID_RGBA = 'must be a string and a valid rgba color'

export const INVALID_IMAGE_FORMAT = 'image type format must be a string and one of ["img", "gif"]'

export const INVALID_FILL_MODE = 'type fillMode must be a string and one of ["none", "contain", "cover", "stretch"]'

export const INVALID_FROM_TIME = `fromTime ${POSITIVE_NUMBER_SUFFIX}`

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
