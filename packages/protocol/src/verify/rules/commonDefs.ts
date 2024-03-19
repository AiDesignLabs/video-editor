import type { IAnimation, IFramesSegmentUnion, IPalette, ITransform, ITransition } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'

export const INVALID_ANIMATION_TYPE = 'data/animation/type must be a string and one of ["in", "out", "combo"]'

type Definition = NonNullable<JSONSchemaType<IFramesSegmentUnion>['definitions']>[string]

// 排除掉 `oneOf` 字段，并将 `properties` 字段进行扩展
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
