import type { IAnimation, IBackground, IDropShadow, IFramesSegmentUnion, IPalette, IStroke, ITextBasic, ITransform, ITransition } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_RGBA } from './common'

export const INVALID_ANIMATION_TYPE = 'data/animation/type must be a string and one of ["in", "out", "combo"]'
export const INVALID_TEXT_BASIC_ALIGN_TYPE = 'data/align must be a string and one of ["left", "center", "right", "justify"]'

type Definition = NonNullable<JSONSchemaType<IFramesSegmentUnion>['definitions']>[string]

// exclude `oneOf` field，and extends `properties` field
type GDefinition<T> = Omit<Definition, 'oneOf'> & {
  properties: Required<Record<keyof T, Definition['properties'][string]>>
  oneOf?: Definition['oneOf']
}

export const commonTransformDefs: GDefinition<ITransform> = {
  type: 'object',
  properties: {
    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
  },
  required: ['position', 'rotation', 'scale'],
}

export const commonAnimationDefs: GDefinition<IAnimation> = {
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

export const commonTransitionDefs: GDefinition<ITransition> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    duration: { type: 'number', minimum: 0 },
  },
  required: ['id', 'name', 'duration'],
}

export const commonPaletteDefs: GDefinition<IPalette> = {
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

export const commonDropShadowDefs: GDefinition<IDropShadow> = {
  type: 'object',
  properties: {
    color: { type: 'string', pattern: '^rgba\\([0-9]+,[0-9]+,[0-9]+,[0-9]+\\)$', nullable: true },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
    blur: { type: 'number', minimum: 0, maximum: 100 },
    distance: { type: 'number' },
    angle: { type: 'number' },
  },
  required: ['color'],
  errorMessage: {
    properties: {
      color: INVALID_RGBA,
    },
  },
}

export const commonStrokeDefs: GDefinition<IStroke> = {
  type: 'object',
  properties: {
    color: { type: 'string', pattern: '^rgba\\([0-9]+,[0-9]+,[0-9]+,[0-9]+\\)$', nullable: true },
    width: { type: 'number' },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['color', 'width'],
  errorMessage: {
    properties: {
      color: INVALID_RGBA,
    },
  },
}

export const commonBackgroundDefs: GDefinition<IBackground> = {
  type: 'object',
  properties: {
    color: { type: 'string', pattern: '^rgba\\([0-9]+,[0-9]+,[0-9]+,[0-9]+\\)$', nullable: true },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['color'],
  errorMessage: {
    properties: {
      color: INVALID_RGBA,
    },
  },
}

export const commonTextBasicDefs: GDefinition<ITextBasic> = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
    dropShadow: { $ref: '#/definitions/IDropShadow' },
    fontFamily: {
      anyOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'string' } },
      ],
    },
    fontSize: { type: 'number' },
    fontWeight: { type: 'string', enum: ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'] },
    fontStyle: { type: 'string', enum: ['normal', 'italic', 'oblique'] },
    underline: { type: 'boolean' },
    fill: { type: 'string', pattern: '^rgba\\([0-9]+,[0-9]+,[0-9]+,[0-9]+\\)$', nullable: true },
    letterSpacing: { type: 'number' },
    leading: { type: 'number' },
    stroke: { $ref: '#/definitions/IStroke' },
    background: { $ref: '#/definitions/IBackground' },
  },
  required: ['content'],
  errorMessage: {
    properties: {
      align: INVALID_TEXT_BASIC_ALIGN_TYPE,
      fill: INVALID_RGBA,
    },
  },
}
