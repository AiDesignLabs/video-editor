import type { IVideoProtocol } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_ID, POSITIVE_NUMBER_SUFFIX, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_BASIC = `${TYPE_ERROR_PREFIX} object`
export const INVALID_VERSION = 'version is not valid semver version'
export const INVALID_WIDTH = `width ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_HEIGHT = `height ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_FPS = `fps ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_TRACKS = 'tracks must be an array'

export const videoProtocolBasicRule: JSONSchemaType<Omit<IVideoProtocol, 'tracks'> & { tracks: any[] }> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    width: { type: 'number', minimum: 0 },
    height: { type: 'number', minimum: 0 },
    fps: { type: 'number', minimum: 1 },
    tracks: { type: 'array', items: { type: 'object' } },
    extra: { type: 'object', nullable: true, additionalProperties: true } as JSONSchemaType<IVideoProtocol>['properties']['extra'],
  },
  required: ['id', 'version', 'width', 'height', 'fps', 'tracks'] as const,
  errorMessage: {
    type: TYPE_ERROR_BASIC,
    properties: {
      id: INVALID_ID,
      version: INVALID_VERSION,
      width: INVALID_WIDTH,
      height: INVALID_HEIGHT,
      fps: INVALID_FPS,
      tracks: INVALID_TRACKS,
    },
  },
}
