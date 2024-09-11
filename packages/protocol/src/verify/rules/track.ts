import type { IVideoProtocol } from '@video-editor/shared'
import type { JSONSchemaType } from 'ajv'
import { INVALID_ID, TYPE_ERROR_PREFIX } from './common'

export const TYPE_ERROR_TRACK = `${TYPE_ERROR_PREFIX} object`
export const INVALID_TRACK_TYPE = 'type trackType must be a string and one of ["frames", "image", "text", "audio", "effect", "filter"]'

type TheTrack = Omit<IVideoProtocol['tracks'][number], 'children'> & { children: object[] }

export const trackRule: JSONSchemaType<TheTrack> = {
  type: 'object',
  properties: {
    trackId: { type: 'string' },
    trackType: { type: 'string', enum: ['frames', 'image', 'text', 'audio', 'effect', 'filter'] },
    children: { type: 'array', items: { type: 'object' } },
    isMain: { type: 'boolean', nullable: true },
  },
  required: ['trackId', 'trackType', 'children'],
  errorMessage: {
    type: TYPE_ERROR_TRACK,
    properties: {
      trackId: INVALID_ID,
      trackType: INVALID_TRACK_TYPE,
    },
  },
}
