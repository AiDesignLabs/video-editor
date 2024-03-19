import type { IAnimation, IFramesSegmentUnion, IPalette, ITransform, ITransition } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_END_TIME, INVALID_ID, INVALID_RGBA, INVALID_START_TIME, POSITIVE_NUMBER_SUFFIX, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_FRAMES_SEGMENT = `${TYPE_ERROR_PREFIX} object`
export const INVALID_IMAGE_FORMAT = 'image type format must be a string and one of ["img", "gif"]'
export const INVALID_URL = 'url must be a string and a valid uri'
export const INVALID_FRAMES_SEGMENT_TYPE = 'type must be a string and one of ["image", "video", "3D"]'
export const INVALID_FROM_TIME = `fromTime ${POSITIVE_NUMBER_SUFFIX}`
export const INVALID_ANIMATION_TYPE = 'data/animation/type must be a string and one of ["in", "out", "combo"]'

type Definition = NonNullable<JSONSchemaType<IFramesSegmentUnion>['definitions']>[string]

// 排除掉 `oneOf` 字段，并将 `properties` 字段进行扩展
type GDefinition<T> = Omit<Definition, 'oneOf'> & {
  properties: Required<Record<keyof T, Definition['properties'][string]>>
  oneOf?: Definition['oneOf']
}

const commonTransformDefs: GDefinition<ITransform> = {
  type: 'object',
  properties: {
    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
  },
  required: ['position', 'rotation', 'scale'],
}

const commonAnimationDefs: GDefinition<IAnimation> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['in', 'out', 'combo'] },
    duration: { type: 'number', minimum: 0 },
    url: { type: 'string', format: 'uri' },
  },
  required: ['id', 'name', 'type', 'duration'],
  errorMessage: {
    properties: {
      type: INVALID_ANIMATION_TYPE,
    },
  },
}

const commonTransitionDefs: GDefinition<ITransition> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    duration: { type: 'number', minimum: 0 },
  },
  required: ['id', 'name', 'duration'],
}

const commonPaletteDefs: GDefinition<IPalette> = {
  type: 'object',
  properties: {
    temperature: { type: 'number', minimum: 1000, maximum: 40000 },
    hue: { type: 'number', minimum: -1, maximum: 1 },
    saturation: { type: 'number', minimum: -1, maximum: 1 },
    brightness: { type: 'number', minimum: -1, maximum: 1 },
    contrast: { type: 'number', minimum: -1, maximum: 1 },
    shine: { type: 'number', minimum: -1, maximum: 1 },
    highlight: { type: 'number', minimum: -1, maximum: 1 },
    shadow: { type: 'number', minimum: -1, maximum: 1 },
    sharpness: { type: 'number', minimum: -1, maximum: 1 },
    vignette: { type: 'number', minimum: 0, maximum: 1 },
    fade: { type: 'number', minimum: 0, maximum: 1 },
    grain: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['temperature', 'hue', 'saturation', 'brightness', 'contrast', 'shine', 'highlight', 'shadow', 'sharpness', 'vignette', 'fade', 'grain'],
}

const CommonDefinitions = {
  ITransform: commonTransformDefs,
  IFillMode: {
    type: 'string',
    enum: ['none', 'contain', 'cover', 'stretch'],
  },
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
    fromTime: { type: 'number', minimum: 0, nullable: true },
    transform: { $ref: '#/definitions/ITransform' },
    opacity: { type: 'number', minimum: 0, maximum: 1, nullable: true },
    fillMode: { $ref: '#/definitions/IFillMode' },
    animation: { $ref: '#/definitions/IAnimation' },
    transitionIn: { $ref: '#/definitions/ITransition' },
    transitionOut: { $ref: '#/definitions/ITransition' },
    palette: { $ref: '#/definitions/IPalette' },
    background: { type: 'string', pattern: '^rgba\\([0-9]+,[0-9]+,[0-9]+,[0-9]+\\)$', nullable: true },
  },
  required: ['id', 'startTime', 'endTime', 'type', 'url'],
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
      type: INVALID_FRAMES_SEGMENT_TYPE,
      fromTime: INVALID_FROM_TIME,
      background: `background${INVALID_RGBA}`,
    },
  },
}
