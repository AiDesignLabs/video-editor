import type { IFramesSegmentUnion } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_ID, INVALID_START_TIME, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_FRAMES_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_FORMAT = 'format must be a string and one of ["img", "gif"]'
export const INVALID_URL = 'url must be a string and a valid uri'
export const INVALID_FRAMES_SEGMENT_TYPE = 'type must be a string and one of ["image", "video", "3D"]'

export const framesSegmentRule: JSONSchemaType<IFramesSegmentUnion> = {
  type: 'object',
  definitions: {
    ITransform: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        scaleX: { type: 'number' },
        scaleY: { type: 'number' },
        scaleZ: { type: 'number' },
        rotateX: { type: 'number' },
        rotateY: { type: 'number' },
        rotateZ: { type: 'number' },
      },
      required: ['x', 'y', 'z', 'scaleX', 'scaleY', 'scaleZ', 'rotateX', 'rotateY', 'rotateZ'],
    },
    IFillMode: {
      type: 'string',
      enum: ['contain', 'cover', 'fill', 'none', 'scale-down'],
    },
    IAnimation: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['none', 'fade', 'slide', 'zoom'] },
        duration: { type: 'number', minimum: 0 },
        direction: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
      },
      required: ['type', 'duration'],
    },
    ITransition: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['none', 'fade', 'slide', 'zoom'] },
        duration: { type: 'number', minimum: 0 },
        direction: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
      },
      required: ['type', 'duration'],
    },
    IPalette: {
      type: 'object',
      properties: {
        primary: { type: 'string' },
        secondary: { type: 'string' },
        tertiary: { type: 'string' },
        quaternary: { type: 'string' },
      },
      required: ['primary', 'secondary', 'tertiary', 'quaternary'],
    },
  },
  properties: {
    id: { type: 'string' },
    startTime: { type: 'number', minimum: 0 },
    endTime: { type: 'number', minimum: 0 },
    type: {
      type: 'string',
      oneOf: [{ const: 'image' }, { const: 'video' }, { const: '3D' }],

    },
    url: { type: 'string', format: 'uri' },
    transform: { $ref: '#/definitions/ITransform' },
    opacity: { type: 'number', minimum: 0, maximum: 1, nullable: true },
    fillMode: { $ref: '#/definitions/IFillMode' },
    animation: { $ref: '#/definitions/IAnimation' },
    transitionIn: { $ref: '#/definitions/ITransition' },
    transitionOut: { $ref: '#/definitions/ITransition' },
    palette: { $ref: '#/definitions/IPalette' },
    background: { type: 'string', pattern: '^rgba\\([0-9]+,[0-9]+,[0-9]+,[0-9]+\\)$', nullable: true },
  },
  uniqueItemProperties: ['id'],
  required: ['id', 'startTime', 'endTime', 'type', 'url'],
  if: { properties: { type: { const: 'image' } } },
  then: { required: ['format'] },
  else: { required: ['id'] },
  errorMessage: {
    type: TYPE_ERROR_FRAMES_SEGMENT,
    properties: {
      id: INVALID_ID,
      startTime: INVALID_START_TIME,
      endTime: INVALID_END_TIME,
      format: INVALID_FORMAT,
      url: INVALID_URL,
      type: INVALID_FRAMES_SEGMENT_TYPE,
    },
  },
}
