import type { IFilterSegment } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_ID, INVALID_START_TIME, INVALID_URL, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_FILTER_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_FILTER_SEGMENT_TYPE = 'type segmentType must be a string and equal to "filter"'

export const filterSegmentRule: JSONSchemaType<IFilterSegment> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    startTime: { type: 'number', minimum: 0 },
    endTime: { type: 'number', minimum: 0 },
    url: { type: 'string', format: 'uri', nullable: true },
    segmentType: { type: 'string', const: 'filter' },
    filterId: { type: 'string' },
    name: { type: 'string' },
    intensity: { type: 'number', minimum: 0, maximum: 1, nullable: true },
  },
  required: ['id', 'startTime', 'endTime', 'filterId', 'name', 'segmentType'],
  errorMessage: {
    type: TYPE_ERROR_FILTER_SEGMENT,
    properties: {
      id: INVALID_ID,
      startTime: INVALID_START_TIME,
      endTime: INVALID_END_TIME,
      url: INVALID_URL,
      segmentType: INVALID_FILTER_SEGMENT_TYPE,
    },
  },
}
