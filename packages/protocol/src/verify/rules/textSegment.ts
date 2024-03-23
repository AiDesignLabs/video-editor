import type { ITextSegment } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_ID, INVALID_START_TIME, INVALID_URL, TYPE_ERROR_PREFIX } from './common'
import { commonAnimationDefs, commonBackgroundDefs, commonDropShadowDefs, commonStrokeDefs, commonTextBasicDefs, commonTransformDefs } from './commonDefs'

export const TYPE_ERROR_TEXT_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_TEXTS = 'data/texts must be an array and at least one item'

const CommonDefinitions = {
  ITransform: commonTransformDefs,
  IAnimation: commonAnimationDefs,
  ITextBasic: commonTextBasicDefs,
  IStroke: commonStrokeDefs,
  IDropShadow: commonDropShadowDefs,
  IBackground: commonBackgroundDefs,
} as JSONSchemaType<ITextSegment>['definitions']

export const textSegmentRule: JSONSchemaType<ITextSegment> = {
  type: 'object',
  definitions: CommonDefinitions,
  properties: {
    id: { type: 'string' },
    startTime: { type: 'number', minimum: 0, nullable: false },
    endTime: { type: 'number', minimum: 0, nullable: false },
    url: { type: 'string', format: 'uri', nullable: true },
    texts: { type: 'array', items: { type: 'object', $ref: '#/definitions/ITextBasic', required: [] }, minItems: 1 },
    transform: { $ref: '#/definitions/ITransform' },
    animation: { $ref: '#/definitions/IAnimation' },
    opacity: { type: 'number', minimum: 0, maximum: 1, nullable: true },
  },
  required: ['id', 'startTime', 'endTime', 'texts'],
  errorMessage: {
    type: TYPE_ERROR_TEXT_SEGMENT,
    properties: {
      id: INVALID_ID,
      startTime: INVALID_START_TIME,
      endTime: INVALID_END_TIME,
      url: INVALID_URL,
      text: INVALID_TEXTS,
    },
  },
}
