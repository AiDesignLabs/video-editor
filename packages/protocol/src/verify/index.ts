import type { IAudioSegment, IFramesSegmentUnion, IImageSegment, ITextSegment, IVideoProtocol } from '@video-editor/shared'
import Ajv from 'ajv'
import ajvErrors from 'ajv-errors'
import ajvKeywords from 'ajv-keywords'
import ajvFormats from 'ajv-formats'
import { audioSegmentRule, framesSegmentRule, imageSegmentRule, textSegmentRule, videoProtocolBasicRule } from './rules'

export function createVerify() {
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

  const verifyBasic = (o: object) => {
    if (validateBasic(o) === false)
      throw new Error(ajv.errorsText(validateBasic.errors))

    return o as IVideoProtocol
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

  return { verifyBasic, verifyFramesSegment, verifyTextSegment, verifyPhotoSegment, verifyAudioSegment }
}
