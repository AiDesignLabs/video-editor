import type { IAudioSegment, IEffectSegment, IFilterSegment, IFramesSegmentUnion, IStickerSegment, ITextSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { createValidator, DUPLICATE_SEGMENT_ID, DUPLICATE_TRACK_ID } from './index'
import { generateMissingRequiredReg, generateTypeErrorPrefixReg, INVALID_ANIMATION_TYPE, INVALID_AUDIO_SEGMENT_TYPE, INVALID_EFFECT_SEGMENT_TYPE, INVALID_END_TIME, INVALID_FILL_MODE, INVALID_FILTER_SEGMENT_TYPE, INVALID_FPS, INVALID_FRAMES_SEGMENT_TYPE, INVALID_FRAMES_TYPE, INVALID_FROM_TIME, INVALID_HEIGHT, INVALID_ID, INVALID_IMAGE_FORMAT, INVALID_RGBA, INVALID_START_TIME, INVALID_STICKER_SEGMENT_TYPE, INVALID_TEXT_BASIC_ALIGN_TYPE, INVALID_TEXT_SEGMENT_TYPE, INVALID_TRACK_TYPE, INVALID_TRACKS, INVALID_URL, INVALID_VERSION, INVALID_WIDTH, TYPE_ERROR_AUDIO_SEGMENT, TYPE_ERROR_EFFECT_SEGMENT, TYPE_ERROR_FILTER_SEGMENT, TYPE_ERROR_FRAMES_SEGMENT, TYPE_ERROR_STICKER_SEGMENT, TYPE_ERROR_TEXT_SEGMENT, TYPE_ERROR_TRACK } from './rules'

describe('verify basic info of video protocol', () => {
  const { verifyBasic } = createValidator()
  const videoProtocol = { id: 'vp-0', version: '0.0.1', width: 500, height: 500, fps: 25, tracks: [] }
  it('valid video protocol', () => {
    const o = verifyBasic(videoProtocol)
    expect(o).toEqual(videoProtocol)
  })

  describe('invalid video protocol', () => {
    it('with invalid object', () => {
      // @ts-expect-error test invalid object
      expect(() => verifyBasic('')).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      // @ts-expect-error test invalid object
      expect(() => verifyBasic(1)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      // @ts-expect-error test invalid object
      expect(() => verifyBasic(null)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      expect(() => verifyBasic([])).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
    })

    describe('with missing attributes', () => {
      it('missing id', () => {
        const videoProtocol = { version: '0.0.1', width: 500, height: 500, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('id'))
      })

      it('missing width', () => {
        const videoProtocol = { id: 'vp-0', version: '0.0.1', height: 500, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('width'))
      })

      it('missing height', () => {
        const videoProtocol = { id: 'vp-0', version: '0.0.1', width: 500, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('height'))
      })

      it('missing fps', () => {
        const videoProtocol = { id: 'vp-0', version: '0.0.1', width: 500, height: 500, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('fps'))
      })

      it('missing tracks', () => {
        const videoProtocol = { id: 'vp-0', version: '0.0.1', width: 500, height: 500, fps: 25 }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('tracks'))
      })

      it('missing multiple attributes', () => {
        const videoProtocol = { id: 'vp-0', version: '0.0.1', width: 500 }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg(['height', 'fps', 'tracks']))
      })

      it('missing all attributes', () => {
        expect(() => verifyBasic({})).toThrowError(generateMissingRequiredReg(['id', 'version', 'height', 'width', 'fps', 'tracks']))
      })
    })

    describe('invalid values', () => {
      it('invalid version', () => {
        const o = { ...videoProtocol, version: 1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_VERSION)
        const o2 = { ...videoProtocol, version: '0.1' }
        expect(() => verifyBasic(o2)).toThrowError(INVALID_VERSION)
      })

      it('invalid width', () => {
        const o = { ...videoProtocol, width: -1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_WIDTH)
      })

      it('invalid height', () => {
        const o = { ...videoProtocol, height: -1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_HEIGHT)
      })

      it('invalid fps', () => {
        const o = { ...videoProtocol, fps: -1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_FPS)
      })

      it('invalid tracks', () => {
        const videoProtocol = { version: '0.0.1', width: 500, height: 500, fps: 25 }
        Object.assign(videoProtocol, { tracks: '' })
        expect(() => verifyBasic(videoProtocol)).toThrowError(INVALID_TRACKS)
        Object.assign(videoProtocol, { tracks: 1 })
        expect(() => verifyBasic(videoProtocol)).toThrowError(INVALID_TRACKS)
        Object.assign(videoProtocol, { tracks: null })
        expect(() => verifyBasic(videoProtocol)).toThrowError(INVALID_TRACKS)
      })
    })
  })
})

describe('verify segment of video protocol', () => {
  const { verifyFramesSegment, verifyTextSegment, verifyStickerSegment, verifyAudioSegment, verifyEffectSegment, verifyFilterSegment } = createValidator()

  describe('frames segment', () => {
    const videoFramesSegment: IVideoFramesSegment = { segmentType: 'frames', id: '1', startTime: 0, endTime: 500, type: 'video', url: 'https://example.com/video.mp4' }
    describe('valid frames segment', () => {
      it('valid video frames segment', () => {
        const o = verifyFramesSegment(videoFramesSegment)
        expect(o).toEqual(videoFramesSegment)
      })
    })

    describe('invalid frames segment', () => {
      it('with invalid object', () => {
        // @ts-expect-error test invalid object
        expect(() => verifyFramesSegment('')).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyFramesSegment(1)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyFramesSegment(null)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
        expect(() => verifyFramesSegment([])).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      })

      describe('missing attributes', () => {
        it('missing id', () => {
          const o = { startTime: 0, endTime: 500, type: 'video', url: 'https://example.com/video.mp4', segmentType: 'frames' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        it('missing startTime', () => {
          const o = { id: '1', endTime: 500, type: 'video', url: 'https://example.com/video.mp4', segmentType: 'frames' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        it('missing endTime', () => {
          const o = { id: '1', startTime: 0, type: 'video', url: 'https://example.com/video.mp4', segmentType: 'frames' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        it('missing url', () => {
          const o = { id: '1', startTime: 0, endTime: 500, type: 'video', segmentType: 'frames' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('url'))
        })

        it('missing type', () => {
          const o = { id: '1', startTime: 0, endTime: 500, url: 'https://example.com/video.mp4', segmentType: 'frames' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('type', { match: 'end' }))
        })

        it('with type image missing format', () => {
          const o = { id: '1', startTime: 0, endTime: 500, type: 'image', url: 'https://example.com/image.png', segmentType: 'frames' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('format', { match: 'start' }))
        })

        it('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, type: 'video' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'url', 'segmentType']))
        })

        it('missing all attributes', () => {
          expect(() => verifyFramesSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'type', 'url', 'segmentType'], { match: 'end' }))
        })
      })

      describe('invalid values', () => {
        it('invalid id', () => {
          const o = { ...videoFramesSegment, id: 1 }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_ID)
        })

        it('invalid startTime', () => {
          const o = { ...videoFramesSegment, startTime: -1 }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_START_TIME)
        })

        it('invalid endTime', () => {
          const o = { ...videoFramesSegment, endTime: -1 }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_END_TIME)
        })

        it('invalid url', () => {
          const o = { ...videoFramesSegment, url: 'invalid' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_URL)
        })

        it('invalid type', () => {
          const o = { ...videoFramesSegment, type: 'invalid' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FRAMES_TYPE)
        })

        it('invalid type image', () => {
          const o = { ...videoFramesSegment, type: 'image', format: 'invalid' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_IMAGE_FORMAT)
        })

        describe('invalid type video', () => {
          it('invalid type video', () => {
            const o = { ...videoFramesSegment, type: 'video', fromTime: -1 }
            expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FROM_TIME)
          })

          it('invalid type transform', () => {
            const o = { ...videoFramesSegment, transform: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(generateTypeErrorPrefixReg('/transform'))
            const o1 = { ...videoFramesSegment, type: 'video', transform: {} }
            expect(() => verifyFramesSegment(o1)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform' }))
            const o2 = { ...videoFramesSegment, type: 'video', transform: { position: [2, 2, 2, 2] } }
            expect(() => verifyFramesSegment(o2)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform', match: 'start' }))
          })

          it('invalid type fillMode', () => {
            const o = { ...videoFramesSegment, fillMode: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FILL_MODE)
          })

          it('invalid type animation', () => {
            const o = { ...videoFramesSegment, type: 'video', animation: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(generateTypeErrorPrefixReg('/animation'))
            const o1 = { ...videoFramesSegment, type: 'video', animation: {} }
            expect(() => verifyFramesSegment(o1)).toThrowError(generateMissingRequiredReg(['id', 'name', 'type', 'duration'], { path: '/animation' }))
            const o2 = { ...videoFramesSegment, type: 'video', animation: { type: 'invalid', duration: 1000 } }
            expect(() => verifyFramesSegment(o2)).toThrowError(INVALID_ANIMATION_TYPE)
            const o3 = { ...videoFramesSegment, type: 'video', animation: { type: 'in', duration: -1 } }
            expect(() => verifyFramesSegment(o3)).toThrowError(generateTypeErrorPrefixReg('/animation/duration', '>= 0'))
          })

          it('invalid type transition', () => {
            const o = { ...videoFramesSegment, type: 'video', transitionIn: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(generateTypeErrorPrefixReg('/transitionIn'))
            const o1 = { ...videoFramesSegment, type: 'video', transitionIn: {} }
            expect(() => verifyFramesSegment(o1)).toThrowError(generateMissingRequiredReg(['id', 'name', 'duration'], { path: '/transitionIn' }))
            const o2 = { ...videoFramesSegment, type: 'video', transitionIn: { id: 123, name: 'test', duration: 1000 } }
            expect(() => verifyFramesSegment(o2)).toThrowError(generateTypeErrorPrefixReg('/transitionIn/id', 'string'))
            const o3 = { ...videoFramesSegment, type: 'video', transitionIn: { id: '123', name: 345, duration: 1000 } }
            expect(() => verifyFramesSegment(o3)).toThrowError(generateTypeErrorPrefixReg('/transitionIn/name', 'string'))
            const o4 = { ...videoFramesSegment, type: 'video', transitionIn: { id: '123', name: 'test', duration: -1 } }
            expect(() => verifyFramesSegment(o4)).toThrowError(generateTypeErrorPrefixReg('/transitionIn/duration', '>= 0'))
          })

          it('invalid type palette', () => {
            const o = { ...videoFramesSegment, type: 'video', palette: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(generateTypeErrorPrefixReg('/palette'))
            const o1 = { ...videoFramesSegment, type: 'video', palette: {} }
            expect(() => verifyFramesSegment(o1)).toThrowError(generateMissingRequiredReg(['temperature', 'hue', 'saturation', 'brightness', 'contrast', 'shine', 'highlight', 'shadow', 'sharpness', 'vignette', 'fade', 'grain'], { path: '/palette' }))
          })

          it('invalid type background', () => {
            const o = { ...videoFramesSegment, type: 'video', background: {} }
            expect(() => verifyFramesSegment(o)).toThrowError(`background${INVALID_RGBA}`)
            const o1 = { ...videoFramesSegment, type: 'video', background: '11' }
            expect(() => verifyFramesSegment(o1)).toThrowError(`background${INVALID_RGBA}`)
            const o2 = { ...videoFramesSegment, type: 'video', background: 'rgba(0,0,0,2)' }
            expect(verifyFramesSegment(o2)).toEqual(o2)
          })

          it('invalid segmentType', () => {
            const o = { ...videoFramesSegment, segmentType: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FRAMES_SEGMENT_TYPE)
          })
        })
      })
    })
  })

  describe('text segment', () => {
    const textSegment: ITextSegment = { segmentType: 'text', id: '1', startTime: 0, endTime: 500, texts: [{ content: 'hello wendraw' }] }
    it('valid text frames segment', () => {
      const o = verifyTextSegment(textSegment)
      expect(o).toEqual(textSegment)
    })

    describe('invalid text segment', () => {
      it('with invalid object', () => {
        // @ts-expect-error test invalid object
        expect(() => verifyTextSegment('')).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyTextSegment(1)).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyTextSegment(null)).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
        expect(() => verifyTextSegment([])).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
      })

      describe('missing attributes', () => {
        it('missing id', () => {
          const o = { startTime: 0, endTime: 500, texts: [{ content: 'hello wendraw' }], segmentType: 'text' }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        it('missing startTime', () => {
          const o = { id: '1', endTime: 500, texts: [{ content: 'hello wendraw' }], segmentType: 'text' }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        it('missing endTime', () => {
          const o = { id: '1', startTime: 0, texts: [{ content: 'hello wendraw' }], segmentType: 'text' }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        it('missing texts', () => {
          const o = { id: '1', startTime: 0, endTime: 500, segmentType: 'text' }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('texts'))
        })

        it('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0 }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'texts', 'segmentType']))
        })

        it('missing all attributes', () => {
          expect(() => verifyTextSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'texts', 'segmentType']))
        })
      })

      describe('invalid values', () => {
        it('invalid id', () => {
          const o = { ...textSegment, id: 1 }
          expect(() => verifyTextSegment(o)).toThrowError(INVALID_ID)
        })

        it('invalid startTime', () => {
          const o = { ...textSegment, startTime: -1 }
          expect(() => verifyTextSegment(o)).toThrowError(INVALID_START_TIME)
        })

        it('invalid endTime', () => {
          const o = { ...textSegment, endTime: -1 }
          expect(() => verifyTextSegment(o)).toThrowError(INVALID_END_TIME)
        })

        describe('invalid texts', () => {
          it('invalid type', () => {
            const o = { ...textSegment, texts: '' }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts', 'array'))
          })

          it('invalid empty length', () => {
            const o1 = { ...textSegment, texts: [] }
            expect(() => verifyTextSegment(o1)).toThrowError('data/texts must NOT have fewer than 1 items')
          })

          it('miss content', () => {
            const o = { ...textSegment, texts: [{}] }
            expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('content', { path: '/texts/0' }))
          })

          it('invalid content', () => {
            const o = { ...textSegment, texts: [{ content: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/content', 'string'))
          })

          it('invalid align', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', align: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(INVALID_TEXT_BASIC_ALIGN_TYPE)
          })

          it('invalid dropShadow', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', dropShadow: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/dropShadow', 'object'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', dropShadow: {} }] }
            expect(() => verifyTextSegment(o1)).toThrowError(generateMissingRequiredReg(['color'], { path: '/texts/0/dropShadow' }))
          })

          it('invalid fontFamily', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontFamily: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontFamily', 'string'))
          })

          it('invalid fontSize', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontSize: '1' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontSize', 'number'))
          })

          it('invalid fontWeight', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontWeight: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontWeight', 'string'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', fontWeight: 'invalid' }] }
            expect(() => verifyTextSegment(o1)).toThrowError()
          })

          it('invalid fontStyle', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontStyle: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontStyle', 'string'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', fontStyle: 'invalid' }] }
            expect(() => verifyTextSegment(o1)).toThrowError()
          })

          it('invalid underline', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', underline: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/underline', 'boolean'))
          })

          it('invalid fill', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fill: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError()

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', fill: 'invalid' }] }
            expect(() => verifyTextSegment(o1)).toThrowError(INVALID_RGBA)
          })

          it('invalid letterSpacing', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', letterSpacing: '1' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/letterSpacing', 'number'))
          })

          it('invalid leading', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', leading: '1' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/leading', 'number'))
          })

          it('invalid stroke', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', stroke: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/stroke', 'object'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', stroke: {} }] }
            expect(() => verifyTextSegment(o1)).toThrowError(generateMissingRequiredReg(['color', 'width'], { path: '/texts/0/stroke' }))
          })

          it('invalid background', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', background: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/background', 'object'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', background: {} }] }
            expect(() => verifyTextSegment(o1)).toThrowError(generateMissingRequiredReg(['color'], { path: '/texts/0/background' }))
          })

          it('invalid segmentType', () => {
            const o = { ...textSegment, segmentType: 'invalid' }
            expect(() => verifyTextSegment(o)).toThrowError(INVALID_TEXT_SEGMENT_TYPE)
          })
        })
      })
    })
  })

  describe('sticker segment', () => {
    const stickerSegment: IStickerSegment = { segmentType: 'sticker', id: '1', startTime: 0, endTime: 500, format: 'img', url: 'https://example.com/image.png' }
    it('valid sticker segment', () => {
      const o = verifyStickerSegment(stickerSegment)
      expect(o).toEqual(stickerSegment)
    })

    describe('invalid sticker segment', () => {
      it('with invalid object', () => {
        // @ts-expect-error test invalid object
        expect(() => verifyStickerSegment('')).toThrowError(TYPE_ERROR_STICKER_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyStickerSegment(1)).toThrowError(TYPE_ERROR_STICKER_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyStickerSegment(null)).toThrowError(TYPE_ERROR_STICKER_SEGMENT)
        expect(() => verifyStickerSegment([])).toThrowError(TYPE_ERROR_STICKER_SEGMENT)
      })

      describe('missing attributes', () => {
        it('missing id', () => {
          const o = { startTime: 0, endTime: 500, format: 'img', url: 'https://example.com/image.png', segmentType: 'sticker' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        it('missing startTime', () => {
          const o = { id: '1', endTime: 500, format: 'img', url: 'https://example.com/image.png', segmentType: 'sticker' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        it('missing endTime', () => {
          const o = { id: '1', startTime: 0, format: 'img', url: 'https://example.com/image.png', segmentType: 'sticker' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        it('missing format', () => {
          const o = { id: '1', startTime: 0, endTime: 500, url: 'https://example.com/image.png', segmentType: 'sticker' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateMissingRequiredReg('format'))
        })

        it('missing url', () => {
          const o = { id: '1', startTime: 0, endTime: 500, format: 'img', segmentType: 'sticker' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateMissingRequiredReg('url'))
        })

        it('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, format: 'img' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'url', 'segmentType']))
        })

        it('missing all attributes', () => {
          expect(() => verifyStickerSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'format', 'url', 'segmentType']))
        })
      })

      describe('invalid values', () => {
        it('invalid id', () => {
          const o = { ...stickerSegment, id: 1 }
          expect(() => verifyStickerSegment(o)).toThrowError(INVALID_ID)
        })

        it('invalid startTime', () => {
          const o = { ...stickerSegment, startTime: -1 }
          expect(() => verifyStickerSegment(o)).toThrowError(INVALID_START_TIME)
        })

        it('invalid endTime', () => {
          const o = { ...stickerSegment, endTime: -1 }
          expect(() => verifyStickerSegment(o)).toThrowError(INVALID_END_TIME)
        })

        it('invalid url', () => {
          const o = { ...stickerSegment, url: 'invalid' }
          expect(() => verifyStickerSegment(o)).toThrowError(INVALID_URL)
        })

        it('invalid format', () => {
          const o = { ...stickerSegment, format: 'invalid' }
          expect(() => verifyStickerSegment(o)).toThrowError(INVALID_IMAGE_FORMAT)
        })

        it('invalid type fillMode', () => {
          const o = { ...stickerSegment, fillMode: 'invalid' }
          expect(() => verifyStickerSegment(o)).toThrowError(INVALID_FILL_MODE)
        })

        it('invalid type animation', () => {
          const o = { ...stickerSegment, type: 'video', animation: 'invalid' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateTypeErrorPrefixReg('/animation'))
          const o1 = { ...stickerSegment, type: 'video', animation: {} }
          expect(() => verifyStickerSegment(o1)).toThrowError(generateMissingRequiredReg(['id', 'name', 'type', 'duration'], { path: '/animation' }))
          const o2 = { ...stickerSegment, type: 'video', animation: { type: 'invalid', duration: 1000 } }
          expect(() => verifyStickerSegment(o2)).toThrowError(INVALID_ANIMATION_TYPE)
          const o3 = { ...stickerSegment, type: 'video', animation: { type: 'in', duration: -1 } }
          expect(() => verifyStickerSegment(o3)).toThrowError(generateTypeErrorPrefixReg('/animation/duration', '>= 0'))
        })

        it('invalid type transform', () => {
          const o = { ...stickerSegment, transform: 'invalid' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateTypeErrorPrefixReg('/transform'))
          const o1 = { ...stickerSegment, type: 'video', transform: {} }
          expect(() => verifyStickerSegment(o1)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform' }))
          const o2 = { ...stickerSegment, type: 'video', transform: { position: [2, 2, 2, 2] } }
          expect(() => verifyFramesSegment(o2)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform', match: 'start' }))
        })

        it('invalid type palette', () => {
          const o = { ...stickerSegment, type: 'video', palette: 'invalid' }
          expect(() => verifyStickerSegment(o)).toThrowError(generateTypeErrorPrefixReg('/palette'))
          const o1 = { ...stickerSegment, type: 'video', palette: {} }
          expect(() => verifyStickerSegment(o1)).toThrowError(generateMissingRequiredReg(['temperature', 'hue', 'saturation', 'brightness', 'contrast', 'shine', 'highlight', 'shadow', 'sharpness', 'vignette', 'fade', 'grain'], { path: '/palette' }))
        })

        it('invalid segmentType', () => {
          const o = { ...stickerSegment, segmentType: 'invalid' }
          expect(() => verifyStickerSegment(o)).toThrowError(INVALID_STICKER_SEGMENT_TYPE)
        })
      })
    })
  })

  describe('audio segment', () => {
    const audioSegment: IAudioSegment = { segmentType: 'audio', id: '1', startTime: 0, endTime: 500, url: 'https://example.com/audio.mp3' }
    it('valid audio segment', () => {
      const o = verifyAudioSegment(audioSegment)
      expect(o).toEqual(audioSegment)
    })

    describe('invalid audio segment', () => {
      it('with invalid object', () => {
        // @ts-expect-error test invalid object
        expect(() => verifyAudioSegment('')).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyAudioSegment(1)).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyAudioSegment(null)).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
        expect(() => verifyAudioSegment([])).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
      })

      describe('missing attributes', () => {
        it('missing id', () => {
          const o = { startTime: 0, endTime: 500, url: 'https://example.com/audio.mp3', segmentType: 'audio' }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        it('missing startTime', () => {
          const o = { id: '1', endTime: 500, url: 'https://example.com/audio.mp3', segmentType: 'audio' }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        it('missing endTime', () => {
          const o = { id: '1', startTime: 0, url: 'https://example.com/audio.mp3', segmentType: 'audio' }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        it('missing url', () => {
          const o = { id: '1', startTime: 0, endTime: 500, segmentType: 'audio' }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('url'))
        })

        it('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'url', 'segmentType']))
        })

        it('missing all attributes', () => {
          expect(() => verifyAudioSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'url', 'segmentType']))
        })
      })

      describe('invalid values', () => {
        it('invalid id', () => {
          const o = { ...audioSegment, id: 1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_ID)
        })

        it('invalid startTime', () => {
          const o = { ...audioSegment, startTime: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_START_TIME)
        })

        it('invalid endTime', () => {
          const o = { ...audioSegment, endTime: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_END_TIME)
        })

        it('invalid url', () => {
          const o = { ...audioSegment, url: 'invalid' }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_URL)
        })

        it('invalid type fromTime', () => {
          const o = { ...audioSegment, fromTime: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_FROM_TIME)
        })

        it('invalid type volume', () => {
          const o = { ...audioSegment, volume: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/volume', '>= 0'))
        })

        it('invalid type playRate', () => {
          const o = { ...audioSegment, playRate: 0 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/playRate', '>= 0.1'))
        })

        it('invalid type fadeInDuration', () => {
          const o = { ...audioSegment, fadeInDuration: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/fadeInDuration', '>= 0'))
        })

        it('invalid type fadeOutDuration', () => {
          const o = { ...audioSegment, fadeOutDuration: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/fadeOutDuration', '>= 0'))
        })

        it('invalid segmentType', () => {
          const o = { ...audioSegment, segmentType: 'invalid' }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_AUDIO_SEGMENT_TYPE)
        })
      })
    })
  })

  describe('effect segment', () => {
    const effectSegment: IEffectSegment = { segmentType: 'effect', id: '1', startTime: 0, endTime: 500, name: 'effect1', effectId: 'effect1Id' }
    it('valid effect segment', () => {
      const o = verifyEffectSegment(effectSegment)
      expect(o).toEqual(effectSegment)
    })

    describe('invalid effect segment', () => {
      it('with invalid object', () => {
        // @ts-expect-error test invalid object
        expect(() => verifyEffectSegment('')).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyEffectSegment(1)).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyEffectSegment(null)).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
        expect(() => verifyEffectSegment([])).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
      })

      describe('missing attributes', () => {
        it('missing id', () => {
          const o = { startTime: 0, endTime: 500, name: 'effect1', effectId: 'effect1Id', segmentType: 'effect' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        it('missing startTime', () => {
          const o = { id: '1', endTime: 500, name: 'effect1', effectId: 'effect1Id', segmentType: 'effect' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        it('missing endTime', () => {
          const o = { id: '1', startTime: 0, name: 'effect1', effectId: 'effect1Id', segmentType: 'effect' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        it('missing name', () => {
          const o = { id: '1', startTime: 0, endTime: 500, effectId: 'effect1Id', segmentType: 'effect' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('name'))
        })

        it('missing effectId', () => {
          const o = { id: '1', startTime: 0, endTime: 500, name: 'effect1', segmentType: 'effect' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('effectId'))
        })

        it('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, name: 'effect1' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'effectId', 'segmentType']))
        })

        it('missing all attributes', () => {
          expect(() => verifyEffectSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'name', 'effectId', 'segmentType']))
        })
      })

      describe('invalid values', () => {
        it('invalid id', () => {
          const o = { ...effectSegment, id: 1 }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_ID)
        })

        it('invalid startTime', () => {
          const o = { ...effectSegment, startTime: -1 }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_START_TIME)
        })

        it('invalid endTime', () => {
          const o = { ...effectSegment, endTime: -1 }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_END_TIME)
        })

        it('invalid name', () => {
          const o = { ...effectSegment, name: 1 }
          expect(() => verifyEffectSegment(o)).toThrowError(generateTypeErrorPrefixReg('/name', 'string'))
        })

        it('invalid effectId', () => {
          const o = { ...effectSegment, effectId: 1 }
          expect(() => verifyEffectSegment(o)).toThrowError(generateTypeErrorPrefixReg('/effectId', 'string'))
        })

        it('invalid url', () => {
          const o = { ...effectSegment, url: 'invalid' }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_URL)
        })

        it('invalid segmentType', () => {
          const o = { ...effectSegment, segmentType: 'invalid' }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_EFFECT_SEGMENT_TYPE)
        })
      })
    })
  })

  describe('filter segment', () => {
    const filterSegment: IFilterSegment = { segmentType: 'filter', id: '1', startTime: 0, endTime: 500, name: 'filter1', filterId: 'filter1Id' }
    it('valid filter segment', () => {
      const o = verifyFilterSegment(filterSegment)
      expect(o).toEqual(filterSegment)
    })

    describe('invalid filter segment', () => {
      it('with invalid object', () => {
        // @ts-expect-error test invalid object
        expect(() => verifyFilterSegment('')).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyFilterSegment(1)).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
        // @ts-expect-error test invalid object
        expect(() => verifyFilterSegment(null)).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
        expect(() => verifyFilterSegment([])).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
      })

      describe('missing attributes', () => {
        it('missing id', () => {
          const o = { startTime: 0, endTime: 500, name: 'filter1', filterId: 'filter1Id', segmentType: 'filter' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        it('missing startTime', () => {
          const o = { id: '1', endTime: 500, name: 'filter1', filterId: 'filter1Id', segmentType: 'filter' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        it('missing endTime', () => {
          const o = { id: '1', startTime: 0, name: 'filter1', filterId: 'filter1Id', segmentType: 'filter' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        it('missing name', () => {
          const o = { id: '1', startTime: 0, endTime: 500, filterId: 'filter1Id', segmentType: 'filter' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('name'))
        })

        it('missing filterId', () => {
          const o = { id: '1', startTime: 0, endTime: 500, name: 'filter1', segmentType: 'filter' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('filterId'))
        })

        it('missing segmentType', () => {
          const o = { id: '1', startTime: 0, endTime: 500, name: 'filter1', filterId: 'filter1Id' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('segmentType'))
        })

        it('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, name: 'filter1' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'filterId', 'segmentType']))
        })
      })

      describe('invalid values', () => {
        it('invalid id', () => {
          const o = { ...filterSegment, id: 1 }
          expect(() => verifyFilterSegment(o)).toThrowError(INVALID_ID)
        })

        it('invalid startTime', () => {
          const o = { ...filterSegment, startTime: -1 }
          expect(() => verifyFilterSegment(o)).toThrowError(INVALID_START_TIME)
        })

        it('invalid endTime', () => {
          const o = { ...filterSegment, endTime: -1 }
          expect(() => verifyFilterSegment(o)).toThrowError(INVALID_END_TIME)
        })

        it('invalid name', () => {
          const o = { ...filterSegment, name: 1 }
          expect(() => verifyFilterSegment(o)).toThrowError(generateTypeErrorPrefixReg('/name', 'string'))
        })

        it('invalid filterId', () => {
          const o = { ...filterSegment, filterId: 1 }
          expect(() => verifyFilterSegment(o)).toThrowError(generateTypeErrorPrefixReg('/filterId', 'string'))
        })

        it('invalid url', () => {
          const o = { ...filterSegment, url: 'invalid' }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_URL)
        })

        it('invalid intensity', () => {
          const o = { ...filterSegment, intensity: -1 }
          expect(() => verifyFilterSegment(o)).toThrowError(generateTypeErrorPrefixReg('/intensity', '>= 0'))
        })

        it('invalid segmentType', () => {
          const o = { ...filterSegment, segmentType: 'invalid' }
          expect(() => verifyFilterSegment(o)).toThrowError(INVALID_FILTER_SEGMENT_TYPE)
        })
      })
    })
  })
})

describe('verify track', () => {
  const track = { trackId: '1', trackType: 'frames', children: [] }

  const { verifyTrack } = createValidator()

  it('valid track', () => {
    const o = verifyTrack(track)
    expect(o).toEqual(track)
  })

  describe('invalid track', () => {
    it('with invalid object', () => {
      // @ts-expect-error test invalid object
      expect(() => verifyTrack('')).toThrowError(TYPE_ERROR_TRACK)
      // @ts-expect-error test invalid object
      expect(() => verifyTrack(1)).toThrowError(TYPE_ERROR_TRACK)
      // @ts-expect-error test invalid object
      expect(() => verifyTrack(null)).toThrowError(TYPE_ERROR_TRACK)
      expect(() => verifyTrack([])).toThrowError(TYPE_ERROR_TRACK)
    })

    describe('missing attributes', () => {
      it('missing trackId', () => {
        const o = { trackType: 'frames', children: [] }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg('trackId'))
      })

      it('missing trackType', () => {
        const o = { trackId: '1', children: [] }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg('trackType'))
      })

      it('missing children', () => {
        const o = { trackId: '1', trackType: 'frames' }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg('children'))
      })

      it('missing multiple attributes', () => {
        const o = { trackId: '1' }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg(['trackType', 'children']))
      })

      it('missing all attributes', () => {
        expect(() => verifyTrack({})).toThrowError(generateMissingRequiredReg(['trackId', 'trackType', 'children']))
      })
    })

    describe('invalid values', () => {
      it('invalid trackId', () => {
        const o = { ...track, trackId: 1 }
        expect(() => verifyTrack(o)).toThrowError(INVALID_ID)
      })

      it('invalid trackType', () => {
        const o = { ...track, trackType: 'invalid' }
        expect(() => verifyTrack(o)).toThrowError(INVALID_TRACK_TYPE)
      })

      it('invalid children', () => {
        const o = { ...track, children: '' }
        expect(() => verifyTrack(o)).toThrowError(generateTypeErrorPrefixReg('/children', 'array'))

        const o1 = { ...track, children: [1] }
        expect(() => verifyTrack(o1)).toThrowError(generateTypeErrorPrefixReg('/children/0', 'object'))
      })

      it('invalid isMain', () => {
        const o = { ...track, isMain: 'invalid' }
        expect(() => verifyTrack(o)).toThrowError(generateTypeErrorPrefixReg('/isMain', 'boolean'))
      })
    })
  })
})

describe('verify video protocol', () => {
  const videoProtocol: IVideoProtocol = { id: 'vp-verify', version: '1.0.0', width: 1920, height: 1080, fps: 30, tracks: [] }
  const framesSegment: IFramesSegmentUnion = { segmentType: 'frames', id: '1', startTime: 0, endTime: 500, type: 'image', format: 'img', url: 'https://example.com/image.png' }
  const textSegment: ITextSegment = { segmentType: 'text', id: '1', startTime: 0, endTime: 500, texts: [{ content: 'hello wendraw' }] }
  const stickerSegment: IStickerSegment = { segmentType: 'sticker', id: '1', startTime: 0, endTime: 500, format: 'img', url: 'https://example.com/image.png' }
  const audioSegment: IAudioSegment = { segmentType: 'audio', id: '1', startTime: 0, endTime: 500, url: 'https://example.com/audio.mp3' }
  const effectSegment: IEffectSegment = { segmentType: 'effect', id: '1', startTime: 0, endTime: 500, name: 'effect1', effectId: 'effect1Id' }
  const filterSegment: IFilterSegment = { segmentType: 'filter', id: '1', startTime: 0, endTime: 500, name: 'filter1', filterId: 'filter1Id' }

  const { verify } = createValidator()

  describe('valid video protocol', () => {
    it('with empty tracks', () => {
      const o = verify(videoProtocol)
      expect(o).toEqual(videoProtocol)
    })

    it('with frames segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [framesSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    it('with text segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'text', children: [textSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    it('with sticker segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'sticker', children: [stickerSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    it('with audio segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'audio', children: [audioSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    it('with effect segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'effect', children: [effectSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    it('with filter segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'filter', children: [filterSegment] }] }
      expect(verify(o)).toEqual(o)
    })
  })

  describe('invalid video protocol', () => {
    it('with invalid basic info', () => {
      const o = { ...videoProtocol, version: 'invalid' }
      expect(() => verify(o)).toThrowError(INVALID_VERSION)
    })

    it('with invalid frames segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [{ ...framesSegment, type: 'invalid' }] }] }
      expect(() => verify(o)).toThrowError(INVALID_FRAMES_TYPE)
    })

    it('with invalid text segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'text', children: [{ ...textSegment, texts: '' }] }] }
      expect(() => verify(o)).toThrowError(generateTypeErrorPrefixReg('/texts', 'array'))
    })

    it('with invalid sticker segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'sticker', children: [{ ...stickerSegment, format: 'invalid' }] }] }
      expect(() => verify(o)).toThrowError(INVALID_IMAGE_FORMAT)
    })

    it('with invalid audio segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'audio', children: [{ ...audioSegment, url: 'invalid' }] }] }
      expect(() => verify(o)).toThrowError(INVALID_URL)
    })

    it('with invalid effect segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'effect', children: [{ ...effectSegment, effectId: 1 }] }] }
      expect(() => verify(o)).toThrowError(generateTypeErrorPrefixReg('/effectId', 'string'))
    })

    it('with invalid filter segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'filter', children: [{ ...filterSegment, filterId: 1 }] }] }
      expect(() => verify(o)).toThrowError(generateTypeErrorPrefixReg('/filterId', 'string'))
    })

    it('with invalid track', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: -1, trackType: 'frames', children: [framesSegment] }] }
      expect(() => verify(o)).toThrowError(INVALID_ID)
    })
  })

  describe('duplicate id', () => {
    it('duplicate track id', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [{ ...framesSegment }] }, { trackId: '1', trackType: 'frames', children: [{ ...framesSegment }] }] }
      expect(() => verify(o)).toThrowError(`${DUPLICATE_TRACK_ID} 1`)
    })

    it('duplicate segment id', () => {
      const o1: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [{ ...framesSegment }, { ...framesSegment }] }] }
      expect(() => verify(o1)).toThrowError(`${DUPLICATE_SEGMENT_ID} 1`)
    })
  })
})
