import type { IVideoProtocol } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { CANVAS_SIZE_SUFFIX, FPS_SUFFIX, INVALID_ID, MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, MIN_FPS, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_BASIC = `${TYPE_ERROR_PREFIX} object`
export const INVALID_VERSION = 'version is not valid semver version'
export const INVALID_WIDTH = `width ${CANVAS_SIZE_SUFFIX}`
export const INVALID_HEIGHT = `height ${CANVAS_SIZE_SUFFIX}`
export const INVALID_FPS = `fps ${FPS_SUFFIX}`
export const INVALID_TRACKS = 'tracks must be an array'

export const videoProtocolBasicRule: JSONSchemaType<Omit<IVideoProtocol, 'tracks'> & { tracks: any[] }> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    width: { type: 'integer', minimum: MIN_CANVAS_SIZE, maximum: MAX_CANVAS_SIZE },
    height: { type: 'integer', minimum: MIN_CANVAS_SIZE, maximum: MAX_CANVAS_SIZE },
    fps: { type: 'number', minimum: MIN_FPS },
    tracks: { type: 'array', items: { type: 'object' } },
    transitions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          duration: { type: 'number', minimum: 0 },
          fromSegmentId: { type: 'string' },
          toSegmentId: { type: 'string' },
        },
        required: ['id', 'name', 'duration', 'fromSegmentId', 'toSegmentId'],
      },
    } as JSONSchemaType<IVideoProtocol>['properties']['transitions'],
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
