import type { IFramesSegmentUnion } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_FILL_MODE, INVALID_FROM_TIME, INVALID_ID, INVALID_IMAGE_FORMAT, INVALID_RGBA, INVALID_START_TIME, INVALID_URL, TYPE_ERROR_PREFIX } from './common'
import { commonAnimationDefs, commonPaletteDefs, commonTransformDefs, commonTransitionDefs } from './commonDefs'

export const TYPE_ERROR_FRAMES_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_FRAMES_TYPE = 'type must be a string and one of ["image", "video", "3D"]'
export const INVALID_FRAMES_SEGMENT_TYPE = 'type segmentType must be a string and equal to "frames"'

const CommonDefinitions = {
  ITransform: commonTransformDefs,
  IAnimation: commonAnimationDefs,
  ITransition: commonTransitionDefs,
  IPalette: commonPaletteDefs,
} as JSONSchemaType<IFramesSegmentUnion>['definitions']

export const framesSegmentRule: JSONSchemaType<IFramesSegmentUnion> = {
  type: 'object',
  definitions: CommonDefinitions,
  properties: {
    id: { type: 'string' },
    startTime: { type: 'number', minimum: 0 },
    endTime: { type: 'number', minimum: 0 },
    type: {
      type: 'string',
      oneOf: [{ const: 'image' }, { const: 'video' }, { const: '3D' }],
    },
    url: { type: 'string', format: 'uri' },
    segmentType: { type: 'string', const: 'frames' },
    fromTime: { type: 'number', minimum: 0, nullable: true },
    transform: { $ref: '#/definitions/ITransform' },
    opacity: { type: 'number', minimum: 0, maximum: 1, nullable: true },
    fillMode: { type: 'string', enum: ['none', 'contain', 'cover', 'stretch'], nullable: true },
    animation: { $ref: '#/definitions/IAnimation' },
    transitionIn: { $ref: '#/definitions/ITransition' },
    transitionOut: { $ref: '#/definitions/ITransition' },
    palette: { $ref: '#/definitions/IPalette' },
    background: { type: 'string', pattern: '^rgba\\([0-9]+,[0-9]+,[0-9]+,[0-9]+\\)$', nullable: true },
  },
  required: ['id', 'startTime', 'endTime', 'type', 'url', 'segmentType'],
  if: { properties: { type: { const: 'image' } } },
  then: { required: ['format'], properties: { format: { type: 'string', enum: ['img', 'gif'] } } },
  else: { required: [] },
  errorMessage: {
    type: TYPE_ERROR_FRAMES_SEGMENT,
    properties: {
      id: INVALID_ID,
      startTime: INVALID_START_TIME,
      endTime: INVALID_END_TIME,
      format: INVALID_IMAGE_FORMAT,
      url: INVALID_URL,
      type: INVALID_FRAMES_TYPE,
      fromTime: INVALID_FROM_TIME,
      background: `background${INVALID_RGBA}`,
      fillMode: INVALID_FILL_MODE,
      segmentType: INVALID_FRAMES_SEGMENT_TYPE,
    },
  },
}
