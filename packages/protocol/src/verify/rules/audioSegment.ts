import type { IAudioSegment } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_FROM_TIME, INVALID_ID, INVALID_START_TIME, INVALID_URL, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_AUDIO_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_AUDIO_SEGMENT_TYPE = 'type segmentType must be a string and equal to "audio"'

export const audioSegmentRule: JSONSchemaType<IAudioSegment> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    startTime: { type: 'number', minimum: 0 },
    endTime: { type: 'number', minimum: 0 },
    url: { type: 'string', format: 'uri' },
    segmentType: { type: 'string', const: 'audio' },
    fromTime: { type: 'number', minimum: 0, nullable: true },
    volume: { type: 'number', minimum: 0, maximum: 1, nullable: true },
    playRate: { type: 'number', minimum: 0.1, maximum: 100, nullable: true },
    fadeInDuration: { type: 'number', minimum: 0, nullable: true },
    fadeOutDuration: { type: 'number', minimum: 0, nullable: true },
    extra: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
    } as JSONSchemaType<IAudioSegment>['properties']['extra'],
  },
  required: ['id', 'startTime', 'endTime', 'url', 'segmentType'],
  errorMessage: {
    type: TYPE_ERROR_AUDIO_SEGMENT,
    properties: {
      id: INVALID_ID,
      startTime: INVALID_START_TIME,
      endTime: INVALID_END_TIME,
      url: INVALID_URL,
      fromTime: INVALID_FROM_TIME,
      segmentType: INVALID_AUDIO_SEGMENT_TYPE,
    },
  },
}
