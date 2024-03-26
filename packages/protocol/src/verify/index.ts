import type { IAudioSegment, IEffectSegment, IFilterSegment, IFramesSegmentUnion, IImageSegment, ITextSegment, IVideoProtocol } from '@video-editor/shared'
import Ajv from 'ajv'
import ajvErrors from 'ajv-errors'
import ajvKeywords from 'ajv-keywords'
import ajvFormats from 'ajv-formats'
import { audioSegmentRule, effectSegmentRule, filterSegmentRule, framesSegmentRule, imageSegmentRule, textSegmentRule, trackRule, videoProtocolBasicRule } from './rules'

export function createValidator() {
  const ajv = new Ajv({ allErrors: true, strict: 'log' })
  // install ajv-errors plugin
  ajvErrors(ajv)
  // install ajv-keywords plugin
  ajvKeywords(ajv)
  // install ajv-formats plugin
  ajvFormats(ajv)

  const validateBasic = ajv.compile(videoProtocolBasicRule)
  const validateFramesSegment = ajv.compile(framesSegmentRule)
  const validateTextSegment = ajv.compile(textSegmentRule)
  const validateImageSegment = ajv.compile(imageSegmentRule)
  const validateAudioSegment = ajv.compile(audioSegmentRule)
  const validateEffectSegment = ajv.compile(effectSegmentRule)
  const validateFilterSegment = ajv.compile(filterSegmentRule)
  const validateTrack = ajv.compile(trackRule)

  const verifyBasic = (o: object) => {
    if (validateBasic(o) === false)
      throw new Error(ajv.errorsText(validateBasic.errors))

    return o as Omit<IVideoProtocol, 'tracks'> & { tracks: object[] }
  }

  const verifyFramesSegment = (o: object) => {
    if (validateFramesSegment(o) === false)
      throw new Error(ajv.errorsText(validateFramesSegment.errors))

    return o as IFramesSegmentUnion
  }

  const verifyTextSegment = (o: object) => {
    if (validateTextSegment(o) === false)
      throw new Error(ajv.errorsText(validateTextSegment.errors))

    return o as ITextSegment
  }

  const verifyPhotoSegment = (o: object) => {
    if (validateImageSegment(o) === false)
      throw new Error(ajv.errorsText(validateImageSegment.errors))

    return o as IImageSegment
  }

  const verifyAudioSegment = (o: object) => {
    if (validateAudioSegment(o) === false)
      throw new Error(ajv.errorsText(validateAudioSegment.errors))

    return o as IAudioSegment
  }

  const verifyEffectSegment = (o: object) => {
    if (validateEffectSegment(o) === false)
      throw new Error(ajv.errorsText(validateEffectSegment.errors))

    return o as IEffectSegment
  }

  const verifyFilterSegment = (o: object) => {
    if (validateFilterSegment(o) === false)
      throw new Error(ajv.errorsText(validateFilterSegment.errors))

    return o as IFilterSegment
  }

  const verifyTrack = (o: object) => {
    if (validateTrack(o) === false)
      throw new Error(ajv.errorsText(validateTrack.errors))

    return o as Omit<IVideoProtocol['tracks'][number], 'children'> & { children: object[] }
  }

  return { verifyBasic, verifyFramesSegment, verifyTextSegment, verifyPhotoSegment, verifyAudioSegment, verifyEffectSegment, verifyFilterSegment, verifyTrack }
}
