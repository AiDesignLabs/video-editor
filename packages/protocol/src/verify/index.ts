import type { IAudioSegment, IEffectSegment, IFilterSegment, IFramesSegmentUnion, IStickerSegment, ITextSegment, ITrackType, IVideoProtocol } from '@video-editor/shared'
import Ajv from 'ajv'
import ajvErrors from 'ajv-errors'
import ajvFormats from 'ajv-formats'
import ajvKeywords from 'ajv-keywords'
import { audioSegmentRule, effectSegmentRule, filterSegmentRule, framesSegmentRule, stickerSegmentRule, textSegmentRule, trackRule, videoProtocolBasicRule } from './rules'

export const DUPLICATE_SEGMENT_ID = 'duplicate segment id'
export const DUPLICATE_TRACK_ID = 'duplicate track id'

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
  const validateStickerSegment = ajv.compile(stickerSegmentRule)
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

  const verifyStickerSegment = (o: object) => {
    if (validateStickerSegment(o) === false)
      throw new Error(ajv.errorsText(validateStickerSegment.errors))

    return o as IStickerSegment
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

  const verifySegment = (o: object & { segmentType: ITrackType }) => {
    const verifyTrackMap = {
      frames: verifyFramesSegment,
      text: verifyTextSegment,
      sticker: verifyStickerSegment,
      audio: verifyAudioSegment,
      effect: verifyEffectSegment,
      filter: verifyFilterSegment,
    }
    return verifyTrackMap[o.segmentType](o)
  }

  const verify = (o: object): IVideoProtocol => {
    const segmentIds = new Set<string>()
    const trackIds = new Set<string>()
    const validBasic = verifyBasic(o)

    const tracks = validBasic.tracks.map((o) => {
      const track = verifyTrack(o)
      if (trackIds.has(track.trackId))
        throw new Error(`${DUPLICATE_TRACK_ID} ${track.trackId}`)
      trackIds.add(track.trackId)
      return track
    })
    validBasic.tracks = tracks

    for (const track of tracks) {
      const children = track.children.map((o) => {
        const segment = verifySegment({ ...o, segmentType: track.trackType })
        if (segmentIds.has(segment.id))
          throw new Error(`${DUPLICATE_SEGMENT_ID} ${segment.id}`)
        segmentIds.add(segment.id)
        return segment
      })
      track.children = children
    }

    return validBasic as IVideoProtocol
  }

  return { verify, verifyBasic, verifyFramesSegment, verifyTextSegment, verifyStickerSegment, verifyAudioSegment, verifyEffectSegment, verifyFilterSegment, verifyTrack, verifySegment }
}
