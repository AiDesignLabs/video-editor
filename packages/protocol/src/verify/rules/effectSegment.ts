import type { IEffectSegment } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_ID, INVALID_START_TIME, INVALID_URL, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_EFFECT_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_EFFECT_SEGMENT_TYPE = 'type segmentType must be a string and equal to "effect"'

export const effectSegmentRule: JSONSchemaType<IEffectSegment> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    startTime: { type: 'number', minimum: 0 },
    endTime: { type: 'number', minimum: 0 },
    url: { type: 'string', format: 'uri', nullable: true },
    segmentType: { type: 'string', const: 'effect' },
    effectId: { type: 'string' },
    name: { type: 'string' },
    extra: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
    } as JSONSchemaType<IEffectSegment>['properties']['extra'],
  },
  required: ['id', 'startTime', 'endTime', 'effectId', 'name', 'segmentType'],
  errorMessage: {
    type: TYPE_ERROR_EFFECT_SEGMENT,
    properties: {
      id: INVALID_ID,
      startTime: INVALID_START_TIME,
      endTime: INVALID_END_TIME,
      url: INVALID_URL,
      segmentType: INVALID_EFFECT_SEGMENT_TYPE,
    },
  },
}
