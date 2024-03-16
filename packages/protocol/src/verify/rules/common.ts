export const TYPE_ERROR_PREFIX = 'data must be'
export const POSITIVE_NUMBER_SUFFIX = 'must be a positive number'

export const INVALID_START_TIME = `startTime ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_END_TIME = `endTime ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_ID = 'id must be a string'

export function generateMissingRequiredReg(attr: string[] | string): RegExp {
  // match "data must have required property 'height', data must have required property 'fps'"
  return new RegExp(`(data must have required property '(${Array.isArray(attr) ? attr.join('|') : attr})'(,\\s*)?)+`)
}
