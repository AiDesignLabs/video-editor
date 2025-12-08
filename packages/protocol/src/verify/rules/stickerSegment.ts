import type { IStickerSegment } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_FILL_MODE, INVALID_ID, INVALID_IMAGE_FORMAT, INVALID_START_TIME, INVALID_URL, TYPE_ERROR_PREFIX } from './common'
import { commonAnimationDefs, commonPaletteDefs, commonTransformDefs } from './commonDefs'

export const TYPE_ERROR_STICKER_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_STICKER_SEGMENT_TYPE = 'type segmentType must be a string and equal to "sticker"'

const CommonDefinitions = {
  ITransform: commonTransformDefs,
  IAnimation: commonAnimationDefs,
  IPalette: commonPaletteDefs,
} as JSONSchemaType<IStickerSegment>['definitions']

export const stickerSegmentRule: JSONSchemaType<IStickerSegment> = {
  type: 'object',
  definitions: CommonDefinitions,
  properties: {
    id: { type: 'string' },
    startTime: { type: 'number', minimum: 0, nullable: false },
    endTime: { type: 'number', minimum: 0, nullable: false },
    url: { type: 'string', format: 'uri', nullable: false },
    format: { type: 'string', enum: ['img', 'gif'], nullable: false },
    segmentType: { type: 'string', const: 'sticker', nullable: false },
    fillMode: { type: 'string', enum: ['none', 'contain', 'cover', 'stretch'], nullable: true },
    animation: { $ref: '#/definitions/IAnimation' },
    transform: { $ref: '#/definitions/ITransform' },
    palette: { $ref: '#/definitions/IPalette' },
    extra: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
    } as JSONSchemaType<IStickerSegment>['properties']['extra'],
  },
  required: ['id', 'startTime', 'endTime', 'format', 'url', 'segmentType'],
  errorMessage: {
    type: TYPE_ERROR_STICKER_SEGMENT,
    properties: {
      id: INVALID_ID,
      startTime: INVALID_START_TIME,
      endTime: INVALID_END_TIME,
      url: INVALID_URL,
      format: INVALID_IMAGE_FORMAT,
      fillMode: INVALID_FILL_MODE,
      segmentType: INVALID_STICKER_SEGMENT_TYPE,
    },
  },
}
