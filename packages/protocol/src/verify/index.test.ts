import type { IAudioSegment, IEffectSegment, IFilterSegment, IFramesSegmentUnion, IImageSegment, ITextSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { INVALID_ANIMATION_TYPE, INVALID_END_TIME, INVALID_FILL_MODE, INVALID_FPS, INVALID_FRAMES_SEGMENT_TYPE, INVALID_FROM_TIME, INVALID_HEIGHT, INVALID_ID, INVALID_IMAGE_FORMAT, INVALID_RGBA, INVALID_START_TIME, INVALID_TEXT_BASIC_ALIGN_TYPE, INVALID_TRACKS, INVALID_TRACK_TYPE, INVALID_URL, INVALID_VERSION, INVALID_WIDTH, TYPE_ERROR_AUDIO_SEGMENT, TYPE_ERROR_EFFECT_SEGMENT, TYPE_ERROR_FILTER_SEGMENT, TYPE_ERROR_FRAMES_SEGMENT, TYPE_ERROR_IMAGE_SEGMENT, TYPE_ERROR_TEXT_SEGMENT, TYPE_ERROR_TRACK, generateMissingRequiredReg, generateTypeErrorPrefixReg } from './rules'
import { DUPLICATE_SEGMENT_ID, DUPLICATE_TRACK_ID, createValidator } from './index'

describe('verify basic info of video protocol', () => {
  const { verifyBasic } = createValidator()
  const videoProtocol = { version: '0.0.1', width: 500, height: 500, fps: 25, tracks: [] }
  test('valid video protocol', () => {
    const o = verifyBasic(videoProtocol)
    expect(o).toEqual(videoProtocol)
  })

  describe('invalid video protocol', () => {
    test('with invalid object', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      expect(() => verifyBasic('')).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      expect(() => verifyBasic(1)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      expect(() => verifyBasic(null)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      expect(() => verifyBasic([])).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
    })

    describe('with missing attributes', () => {
      test('missing width', () => {
        const videoProtocol = { version: '0.0.1', height: 500, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('width'))
      })

      test('missing height', () => {
        const videoProtocol = { version: '0.0.1', width: 500, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('height'))
      })

      test('missing fps', () => {
        const videoProtocol = { version: '0.0.1', width: 500, height: 500, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('fps'))
      })

      test('missing tracks', () => {
        const videoProtocol = { version: '0.0.1', width: 500, height: 500, fps: 25 }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg('tracks'))
      })

      test('missing multiple attributes', () => {
        const videoProtocol = { version: '0.0.1', width: 500 }
        expect(() => verifyBasic(videoProtocol)).toThrowError(generateMissingRequiredReg(['height', 'fps', 'tracks']))
      })

      test('missing all attributes', () => {
        expect(() => verifyBasic({})).toThrowError(generateMissingRequiredReg(['version', 'height', 'width', 'fps', 'tracks']))
      })
    })

    describe('invalid values', () => {
      test('invalid version', () => {
        const o = { ...videoProtocol, version: 1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_VERSION)
        const o2 = { ...videoProtocol, version: '0.1' }
        expect(() => verifyBasic(o2)).toThrowError(INVALID_VERSION)
      })

      test('invalid width', () => {
        const o = { ...videoProtocol, width: -1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_WIDTH)
      })

      test('invalid height', () => {
        const o = { ...videoProtocol, height: -1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_HEIGHT)
      })

      test('invalid fps', () => {
        const o = { ...videoProtocol, fps: -1 }
        expect(() => verifyBasic(o)).toThrowError(INVALID_FPS)
      })

      test('invalid tracks', () => {
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
  const { verifyFramesSegment, verifyTextSegment, verifyPhotoSegment, verifyAudioSegment, verifyEffectSegment, verifyFilterSegment } = createValidator()

  describe('frames segment', () => {
    const videoFramesSegment: IVideoFramesSegment = { id: '1', startTime: 0, endTime: 500, type: 'video', url: 'https://example.com/video.mp4' }
    describe('valid frames segment', () => {
      test('valid video frames segment', () => {
        const o = verifyFramesSegment(videoFramesSegment)
        expect(o).toEqual(videoFramesSegment)
      })
    })

    describe('invalid frames segment', () => {
      test('with invalid object', () => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyFramesSegment('')).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyFramesSegment(1)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyFramesSegment(null)).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
        expect(() => verifyFramesSegment([])).toThrowError(TYPE_ERROR_FRAMES_SEGMENT)
      })

      describe('missing attributes', () => {
        test('missing id', () => {
          const o = { startTime: 0, endTime: 500, type: 'video', url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        test('missing startTime', () => {
          const o = { id: '1', endTime: 500, type: 'video', url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        test('missing endTime', () => {
          const o = { id: '1', startTime: 0, type: 'video', url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        test('missing url', () => {
          const o = { id: '1', startTime: 0, endTime: 500, type: 'video' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('url'))
        })

        test('missing type', () => {
          const o = { id: '1', startTime: 0, endTime: 500, url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('type', { match: 'end' }))
        })

        test('with type image missing format', () => {
          const o = { id: '1', startTime: 0, endTime: 500, type: 'image', url: 'https://example.com/image.png' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('format', { match: 'start' }))
        })

        test('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, type: 'video' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'url']))
        })

        test('missing all attributes', () => {
          expect(() => verifyFramesSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'type', 'url'], { match: 'end' }))
        })
      })

      describe('invalid values', () => {
        test('invalid id', () => {
          const o = { ...videoFramesSegment, id: 1 }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_ID)
        })

        test('invalid startTime', () => {
          const o = { ...videoFramesSegment, startTime: -1 }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_START_TIME)
        })

        test('invalid endTime', () => {
          const o = { ...videoFramesSegment, endTime: -1 }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_END_TIME)
        })

        test('invalid url', () => {
          const o = { ...videoFramesSegment, url: 'invalid' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_URL)
        })

        test('invalid type', () => {
          const o = { ...videoFramesSegment, type: 'invalid' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FRAMES_SEGMENT_TYPE)
        })

        test('invalid type image', () => {
          const o = { ...videoFramesSegment, type: 'image', format: 'invalid' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_IMAGE_FORMAT)
        })

        describe('invalid type video', () => {
          test('invalid type video', () => {
            const o = { ...videoFramesSegment, type: 'video', fromTime: -1 }
            expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FROM_TIME)
          })

          test('invalid type transform', () => {
            const o = { ...videoFramesSegment, transform: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(generateTypeErrorPrefixReg('/transform'))
            const o1 = { ...videoFramesSegment, type: 'video', transform: {} }
            expect(() => verifyFramesSegment(o1)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform' }))
            const o2 = { ...videoFramesSegment, type: 'video', transform: { position: [2, 2, 2, 2] } }
            expect(() => verifyFramesSegment(o2)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform', match: 'start' }))
          })

          test('invalid type fillMode', () => {
            const o = { ...videoFramesSegment, fillMode: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FILL_MODE)
          })

          test('invalid type animation', () => {
            const o = { ...videoFramesSegment, type: 'video', animation: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(generateTypeErrorPrefixReg('/animation'))
            const o1 = { ...videoFramesSegment, type: 'video', animation: {} }
            expect(() => verifyFramesSegment(o1)).toThrowError(generateMissingRequiredReg(['id', 'name', 'type', 'duration'], { path: '/animation' }))
            const o2 = { ...videoFramesSegment, type: 'video', animation: { type: 'invalid', duration: 1000 } }
            expect(() => verifyFramesSegment(o2)).toThrowError(INVALID_ANIMATION_TYPE)
            const o3 = { ...videoFramesSegment, type: 'video', animation: { type: 'in', duration: -1 } }
            expect(() => verifyFramesSegment(o3)).toThrowError(generateTypeErrorPrefixReg('/animation/duration', '>= 0'))
          })

          test('invalid type transition', () => {
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

          test('invalid type palette', () => {
            const o = { ...videoFramesSegment, type: 'video', palette: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowError(generateTypeErrorPrefixReg('/palette'))
            const o1 = { ...videoFramesSegment, type: 'video', palette: {} }
            expect(() => verifyFramesSegment(o1)).toThrowError(generateMissingRequiredReg(['temperature', 'hue', 'saturation', 'brightness', 'contrast', 'shine', 'highlight', 'shadow', 'sharpness', 'vignette', 'fade', 'grain'], { path: '/palette' }))
          })

          test('invalid type background', () => {
            const o = { ...videoFramesSegment, type: 'video', background: {} }
            expect(() => verifyFramesSegment(o)).toThrowError(`background${INVALID_RGBA}`)
            const o1 = { ...videoFramesSegment, type: 'video', background: '11' }
            expect(() => verifyFramesSegment(o1)).toThrowError(`background${INVALID_RGBA}`)
            const o2 = { ...videoFramesSegment, type: 'video', background: 'rgba(0,0,0,2)' }
            expect(verifyFramesSegment(o2)).toEqual(o2)
          })
        })
      })
    })
  })

  describe('text segment', () => {
    const textSegment: ITextSegment = { id: '1', startTime: 0, endTime: 500, texts: [{ content: 'hello wendraw' }] }
    test('valid text frames segment', () => {
      const o = verifyTextSegment(textSegment)
      expect(o).toEqual(textSegment)
    })

    describe('invalid text segment', () => {
      test('with invalid object', () => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyTextSegment('')).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyTextSegment(1)).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyTextSegment(null)).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
        expect(() => verifyTextSegment([])).toThrowError(TYPE_ERROR_TEXT_SEGMENT)
      })

      describe('missing attributes', () => {
        test('missing id', () => {
          const o = { startTime: 0, endTime: 500, texts: [{ content: 'hello wendraw' }] }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        test('missing startTime', () => {
          const o = { id: '1', endTime: 500, texts: [{ content: 'hello wendraw' }] }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        test('missing endTime', () => {
          const o = { id: '1', startTime: 0, texts: [{ content: 'hello wendraw' }] }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        test('missing texts', () => {
          const o = { id: '1', startTime: 0, endTime: 500 }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('texts'))
        })

        test('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0 }
          expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'texts']))
        })

        test('missing all attributes', () => {
          expect(() => verifyTextSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'texts']))
        })
      })

      describe('invalid values', () => {
        test('invalid id', () => {
          const o = { ...textSegment, id: 1 }
          expect(() => verifyTextSegment(o)).toThrowError(INVALID_ID)
        })

        test('invalid startTime', () => {
          const o = { ...textSegment, startTime: -1 }
          expect(() => verifyTextSegment(o)).toThrowError(INVALID_START_TIME)
        })

        test('invalid endTime', () => {
          const o = { ...textSegment, endTime: -1 }
          expect(() => verifyTextSegment(o)).toThrowError(INVALID_END_TIME)
        })

        describe('invalid texts', () => {
          test('invalid type', () => {
            const o = { ...textSegment, texts: '' }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts', 'array'))
          })

          test('invalid empty length', () => {
            const o1 = { ...textSegment, texts: [] }
            expect(() => verifyTextSegment(o1)).toThrowError('data/texts must NOT have fewer than 1 items')
          })

          test('miss content', () => {
            const o = { ...textSegment, texts: [{}] }
            expect(() => verifyTextSegment(o)).toThrowError(generateMissingRequiredReg('content', { path: '/texts/0' }))
          })

          test('invalid content', () => {
            const o = { ...textSegment, texts: [{ content: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/content', 'string'))
          })

          test('invalid align', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', align: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(INVALID_TEXT_BASIC_ALIGN_TYPE)
          })

          test('invalid dropShadow', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', dropShadow: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/dropShadow', 'object'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', dropShadow: {} }] }
            expect(() => verifyTextSegment(o1)).toThrowError(generateMissingRequiredReg(['color'], { path: '/texts/0/dropShadow' }))
          })

          test('invalid fontFamily', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontFamily: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontFamily', 'string'))
          })

          test('invalid fontSize', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontSize: '1' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontSize', 'number'))
          })

          test('invalid fontWeight', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontWeight: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontWeight', 'string'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', fontWeight: 'invalid' }] }
            expect(() => verifyTextSegment(o1)).toThrowError()
          })

          test('invalid fontStyle', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fontStyle: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/fontStyle', 'string'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', fontStyle: 'invalid' }] }
            expect(() => verifyTextSegment(o1)).toThrowError()
          })

          test('invalid underline', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', underline: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/underline', 'boolean'))
          })

          test('invalid fill', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', fill: 1 }] }
            expect(() => verifyTextSegment(o)).toThrowError()

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', fill: 'invalid' }] }
            expect(() => verifyTextSegment(o1)).toThrowError(INVALID_RGBA)
          })

          test('invalid letterSpacing', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', letterSpacing: '1' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/letterSpacing', 'number'))
          })

          test('invalid leading', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', leading: '1' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/leading', 'number'))
          })

          test('invalid stroke', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', stroke: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/stroke', 'object'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', stroke: {} }] }
            expect(() => verifyTextSegment(o1)).toThrowError(generateMissingRequiredReg(['color', 'width'], { path: '/texts/0/stroke' }))
          })

          test('invalid background', () => {
            const o = { ...textSegment, texts: [{ content: 'hello wendraw', background: 'invalid' }] }
            expect(() => verifyTextSegment(o)).toThrowError(generateTypeErrorPrefixReg('/texts/0/background', 'object'))

            const o1 = { ...textSegment, texts: [{ content: 'hello wendraw', background: {} }] }
            expect(() => verifyTextSegment(o1)).toThrowError(generateMissingRequiredReg(['color'], { path: '/texts/0/background' }))
          })
        })
      })
    })
  })

  describe('image segment', () => {
    const imageSegment: IImageSegment = { id: '1', startTime: 0, endTime: 500, format: 'img', url: 'https://example.com/image.png' }
    test('valid image segment', () => {
      const o = verifyPhotoSegment(imageSegment)
      expect(o).toEqual(imageSegment)
    })

    describe('invalid image segment', () => {
      test('with invalid object', () => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyPhotoSegment('')).toThrowError(TYPE_ERROR_IMAGE_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyPhotoSegment(1)).toThrowError(TYPE_ERROR_IMAGE_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyPhotoSegment(null)).toThrowError(TYPE_ERROR_IMAGE_SEGMENT)
        expect(() => verifyPhotoSegment([])).toThrowError(TYPE_ERROR_IMAGE_SEGMENT)
      })

      describe('missing attributes', () => {
        test('missing id', () => {
          const o = { startTime: 0, endTime: 500, format: 'img', url: 'https://example.com/image.png' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        test('missing startTime', () => {
          const o = { id: '1', endTime: 500, format: 'img', url: 'https://example.com/image.png' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        test('missing endTime', () => {
          const o = { id: '1', startTime: 0, format: 'img', url: 'https://example.com/image.png' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        test('missing format', () => {
          const o = { id: '1', startTime: 0, endTime: 500, url: 'https://example.com/image.png' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateMissingRequiredReg('format'))
        })

        test('missing url', () => {
          const o = { id: '1', startTime: 0, endTime: 500, format: 'img' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateMissingRequiredReg('url'))
        })

        test('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, format: 'img' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'url']))
        })

        test('missing all attributes', () => {
          expect(() => verifyPhotoSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'format', 'url']))
        })
      })

      describe('invalid values', () => {
        test('invalid id', () => {
          const o = { ...imageSegment, id: 1 }
          expect(() => verifyPhotoSegment(o)).toThrowError(INVALID_ID)
        })

        test('invalid startTime', () => {
          const o = { ...imageSegment, startTime: -1 }
          expect(() => verifyPhotoSegment(o)).toThrowError(INVALID_START_TIME)
        })

        test('invalid endTime', () => {
          const o = { ...imageSegment, endTime: -1 }
          expect(() => verifyPhotoSegment(o)).toThrowError(INVALID_END_TIME)
        })

        test('invalid url', () => {
          const o = { ...imageSegment, url: 'invalid' }
          expect(() => verifyPhotoSegment(o)).toThrowError(INVALID_URL)
        })

        test('invalid format', () => {
          const o = { ...imageSegment, format: 'invalid' }
          expect(() => verifyPhotoSegment(o)).toThrowError(INVALID_IMAGE_FORMAT)
        })

        test('invalid type fillMode', () => {
          const o = { ...imageSegment, fillMode: 'invalid' }
          expect(() => verifyPhotoSegment(o)).toThrowError(INVALID_FILL_MODE)
        })

        test('invalid type animation', () => {
          const o = { ...imageSegment, type: 'video', animation: 'invalid' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateTypeErrorPrefixReg('/animation'))
          const o1 = { ...imageSegment, type: 'video', animation: {} }
          expect(() => verifyPhotoSegment(o1)).toThrowError(generateMissingRequiredReg(['id', 'name', 'type', 'duration'], { path: '/animation' }))
          const o2 = { ...imageSegment, type: 'video', animation: { type: 'invalid', duration: 1000 } }
          expect(() => verifyPhotoSegment(o2)).toThrowError(INVALID_ANIMATION_TYPE)
          const o3 = { ...imageSegment, type: 'video', animation: { type: 'in', duration: -1 } }
          expect(() => verifyPhotoSegment(o3)).toThrowError(generateTypeErrorPrefixReg('/animation/duration', '>= 0'))
        })

        test('invalid type transform', () => {
          const o = { ...imageSegment, transform: 'invalid' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateTypeErrorPrefixReg('/transform'))
          const o1 = { ...imageSegment, type: 'video', transform: {} }
          expect(() => verifyPhotoSegment(o1)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform' }))
          const o2 = { ...imageSegment, type: 'video', transform: { position: [2, 2, 2, 2] } }
          expect(() => verifyFramesSegment(o2)).toThrowError(generateMissingRequiredReg(['position', 'rotation', 'scale'], { path: '/transform', match: 'start' }))
        })

        test('invalid type palette', () => {
          const o = { ...imageSegment, type: 'video', palette: 'invalid' }
          expect(() => verifyPhotoSegment(o)).toThrowError(generateTypeErrorPrefixReg('/palette'))
          const o1 = { ...imageSegment, type: 'video', palette: {} }
          expect(() => verifyPhotoSegment(o1)).toThrowError(generateMissingRequiredReg(['temperature', 'hue', 'saturation', 'brightness', 'contrast', 'shine', 'highlight', 'shadow', 'sharpness', 'vignette', 'fade', 'grain'], { path: '/palette' }))
        })
      })
    })
  })

  describe('audio segment', () => {
    const audioSegment: IAudioSegment = { id: '1', startTime: 0, endTime: 500, url: 'https://example.com/audio.mp3' }
    test('valid audio segment', () => {
      const o = verifyAudioSegment(audioSegment)
      expect(o).toEqual(audioSegment)
    })

    describe('invalid audio segment', () => {
      test('with invalid object', () => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyAudioSegment('')).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyAudioSegment(1)).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyAudioSegment(null)).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
        expect(() => verifyAudioSegment([])).toThrowError(TYPE_ERROR_AUDIO_SEGMENT)
      })

      describe('missing attributes', () => {
        test('missing id', () => {
          const o = { startTime: 0, endTime: 500, url: 'https://example.com/audio.mp3' }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        test('missing startTime', () => {
          const o = { id: '1', endTime: 500, url: 'https://example.com/audio.mp3' }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        test('missing endTime', () => {
          const o = { id: '1', startTime: 0, url: 'https://example.com/audio.mp3' }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        test('missing url', () => {
          const o = { id: '1', startTime: 0, endTime: 500 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg('url'))
        })

        test('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'url']))
        })

        test('missing all attributes', () => {
          expect(() => verifyAudioSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'url']))
        })
      })

      describe('invalid values', () => {
        test('invalid id', () => {
          const o = { ...audioSegment, id: 1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_ID)
        })

        test('invalid startTime', () => {
          const o = { ...audioSegment, startTime: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_START_TIME)
        })

        test('invalid endTime', () => {
          const o = { ...audioSegment, endTime: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_END_TIME)
        })

        test('invalid url', () => {
          const o = { ...audioSegment, url: 'invalid' }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_URL)
        })

        test('invalid type fromTime', () => {
          const o = { ...audioSegment, fromTime: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(INVALID_FROM_TIME)
        })

        test('invalid type volume', () => {
          const o = { ...audioSegment, volume: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/volume', '>= 0'))
        })

        test('invalid type playRate', () => {
          const o = { ...audioSegment, playRate: 0 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/playRate', '>= 0.1'))
        })

        test('invalid type fadeInDuration', () => {
          const o = { ...audioSegment, fadeInDuration: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/fadeInDuration', '>= 0'))
        })

        test('invalid type fadeOutDuration', () => {
          const o = { ...audioSegment, fadeOutDuration: -1 }
          expect(() => verifyAudioSegment(o)).toThrowError(generateTypeErrorPrefixReg('/fadeOutDuration', '>= 0'))
        })
      })
    })
  })

  describe('effect segment', () => {
    const effectSegment: IEffectSegment = { id: '1', startTime: 0, endTime: 500, name: 'effect1', effectId: 'effect1Id' }
    test('valid effect segment', () => {
      const o = verifyEffectSegment(effectSegment)
      expect(o).toEqual(effectSegment)
    })

    describe('invalid effect segment', () => {
      test('with invalid object', () => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyEffectSegment('')).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyEffectSegment(1)).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyEffectSegment(null)).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
        expect(() => verifyEffectSegment([])).toThrowError(TYPE_ERROR_EFFECT_SEGMENT)
      })

      describe('missing attributes', () => {
        test('missing id', () => {
          const o = { startTime: 0, endTime: 500, name: 'effect1', effectId: 'effect1Id' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        test('missing startTime', () => {
          const o = { id: '1', endTime: 500, name: 'effect1', effectId: 'effect1Id' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        test('missing endTime', () => {
          const o = { id: '1', startTime: 0, name: 'effect1', effectId: 'effect1Id' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        test('missing name', () => {
          const o = { id: '1', startTime: 0, endTime: 500, effectId: 'effect1Id' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('name'))
        })

        test('missing effectId', () => {
          const o = { id: '1', startTime: 0, endTime: 500, name: 'effect1' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg('effectId'))
        })

        test('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, name: 'effect1' }
          expect(() => verifyEffectSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'effectId']))
        })

        test('missing all attributes', () => {
          expect(() => verifyEffectSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'name', 'effectId']))
        })
      })

      describe('invalid values', () => {
        test('invalid id', () => {
          const o = { ...effectSegment, id: 1 }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_ID)
        })

        test('invalid startTime', () => {
          const o = { ...effectSegment, startTime: -1 }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_START_TIME)
        })

        test('invalid endTime', () => {
          const o = { ...effectSegment, endTime: -1 }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_END_TIME)
        })

        test('invalid name', () => {
          const o = { ...effectSegment, name: 1 }
          expect(() => verifyEffectSegment(o)).toThrowError(generateTypeErrorPrefixReg('/name', 'string'))
        })

        test('invalid effectId', () => {
          const o = { ...effectSegment, effectId: 1 }
          expect(() => verifyEffectSegment(o)).toThrowError(generateTypeErrorPrefixReg('/effectId', 'string'))
        })

        test('invalid url', () => {
          const o = { ...effectSegment, url: 'invalid' }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_URL)
        })
      })
    })
  })

  describe('filter segment', () => {
    const filterSegment: IFilterSegment = { id: '1', startTime: 0, endTime: 500, name: 'filter1', filterId: 'filter1Id' }
    test('valid filter segment', () => {
      const o = verifyFilterSegment(filterSegment)
      expect(o).toEqual(filterSegment)
    })

    describe('invalid filter segment', () => {
      test('with invalid object', () => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyFilterSegment('')).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyFilterSegment(1)).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        expect(() => verifyFilterSegment(null)).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
        expect(() => verifyFilterSegment([])).toThrowError(TYPE_ERROR_FILTER_SEGMENT)
      })

      describe('missing attributes', () => {
        test('missing id', () => {
          const o = { startTime: 0, endTime: 500, name: 'filter1', filterId: 'filter1Id' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('id'))
        })

        test('missing startTime', () => {
          const o = { id: '1', endTime: 500, name: 'filter1', filterId: 'filter1Id' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('startTime'))
        })

        test('missing endTime', () => {
          const o = { id: '1', startTime: 0, name: 'filter1', filterId: 'filter1Id' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('endTime'))
        })

        test('missing name', () => {
          const o = { id: '1', startTime: 0, endTime: 500, filterId: 'filter1Id' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('name'))
        })

        test('missing filterId', () => {
          const o = { id: '1', startTime: 0, endTime: 500, name: 'filter1' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg('filterId'))
        })

        test('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, name: 'filter1' }
          expect(() => verifyFilterSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'filterId']))
        })
      })

      describe('invalid values', () => {
        test('invalid id', () => {
          const o = { ...filterSegment, id: 1 }
          expect(() => verifyFilterSegment(o)).toThrowError(INVALID_ID)
        })

        test('invalid startTime', () => {
          const o = { ...filterSegment, startTime: -1 }
          expect(() => verifyFilterSegment(o)).toThrowError(INVALID_START_TIME)
        })

        test('invalid endTime', () => {
          const o = { ...filterSegment, endTime: -1 }
          expect(() => verifyFilterSegment(o)).toThrowError(INVALID_END_TIME)
        })

        test('invalid name', () => {
          const o = { ...filterSegment, name: 1 }
          expect(() => verifyFilterSegment(o)).toThrowError(generateTypeErrorPrefixReg('/name', 'string'))
        })

        test('invalid filterId', () => {
          const o = { ...filterSegment, filterId: 1 }
          expect(() => verifyFilterSegment(o)).toThrowError(generateTypeErrorPrefixReg('/filterId', 'string'))
        })

        test('invalid url', () => {
          const o = { ...filterSegment, url: 'invalid' }
          expect(() => verifyEffectSegment(o)).toThrowError(INVALID_URL)
        })

        test('invalid intensity', () => {
          const o = { ...filterSegment, intensity: -1 }
          expect(() => verifyFilterSegment(o)).toThrowError(generateTypeErrorPrefixReg('/intensity', '>= 0'))
        })
      })
    })
  })
})

describe('verify track', () => {
  const track = { trackId: '1', trackType: 'frames', children: [] }

  const { verifyTrack } = createValidator()

  test('valid track', () => {
    const o = verifyTrack(track)
    expect(o).toEqual(track)
  })

  describe('invalid track', () => {
    test('with invalid object', () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      expect(() => verifyTrack('')).toThrowError(TYPE_ERROR_TRACK)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      expect(() => verifyTrack(1)).toThrowError(TYPE_ERROR_TRACK)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      expect(() => verifyTrack(null)).toThrowError(TYPE_ERROR_TRACK)
      expect(() => verifyTrack([])).toThrowError(TYPE_ERROR_TRACK)
    })

    describe('missing attributes', () => {
      test('missing trackId', () => {
        const o = { trackType: 'frames', children: [] }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg('trackId'))
      })

      test('missing trackType', () => {
        const o = { trackId: '1', children: [] }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg('trackType'))
      })

      test('missing children', () => {
        const o = { trackId: '1', trackType: 'frames' }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg('children'))
      })

      test('missing multiple attributes', () => {
        const o = { trackId: '1' }
        expect(() => verifyTrack(o)).toThrowError(generateMissingRequiredReg(['trackType', 'children']))
      })

      test('missing all attributes', () => {
        expect(() => verifyTrack({})).toThrowError(generateMissingRequiredReg(['trackId', 'trackType', 'children']))
      })
    })

    describe('invalid values', () => {
      test('invalid trackId', () => {
        const o = { ...track, trackId: 1 }
        expect(() => verifyTrack(o)).toThrowError(INVALID_ID)
      })

      test('invalid trackType', () => {
        const o = { ...track, trackType: 'invalid' }
        expect(() => verifyTrack(o)).toThrowError(INVALID_TRACK_TYPE)
      })

      test('invalid children', () => {
        const o = { ...track, children: '' }
        expect(() => verifyTrack(o)).toThrowError(generateTypeErrorPrefixReg('/children', 'array'))

        const o1 = { ...track, children: [1] }
        expect(() => verifyTrack(o1)).toThrowError(generateTypeErrorPrefixReg('/children/0', 'object'))
      })

      test('invalid isMain', () => {
        const o = { ...track, isMain: 'invalid' }
        expect(() => verifyTrack(o)).toThrowError(generateTypeErrorPrefixReg('/isMain', 'boolean'))
      })
    })
  })
})

describe('verify video protocol', () => {
  const videoProtocol: IVideoProtocol = { version: '1.0.0', width: 1920, height: 1080, fps: 30, tracks: [] }
  const framesSegment: IFramesSegmentUnion = { id: '1', startTime: 0, endTime: 500, type: 'image', format: 'img', url: 'https://example.com/image.png' }
  const textSegment: ITextSegment = { id: '1', startTime: 0, endTime: 500, texts: [{ content: 'hello wendraw' }] }
  const imageSegment: IImageSegment = { id: '1', startTime: 0, endTime: 500, format: 'img', url: 'https://example.com/image.png' }
  const audioSegment: IAudioSegment = { id: '1', startTime: 0, endTime: 500, url: 'https://example.com/audio.mp3' }
  const effectSegment: IEffectSegment = { id: '1', startTime: 0, endTime: 500, name: 'effect1', effectId: 'effect1Id' }
  const filterSegment: IFilterSegment = { id: '1', startTime: 0, endTime: 500, name: 'filter1', filterId: 'filter1Id' }

  const { verify } = createValidator()

  describe('valid video protocol', () => {
    test('with empty tracks', () => {
      const o = verify(videoProtocol)
      expect(o).toEqual(videoProtocol)
    })

    test('with frames segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [framesSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    test('with text segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'text', children: [textSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    test('with image segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'image', children: [imageSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    test('with audio segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'audio', children: [audioSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    test('with effect segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'effect', children: [effectSegment] }] }
      expect(verify(o)).toEqual(o)
    })

    test('with filter segment', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'filter', children: [filterSegment] }] }
      expect(verify(o)).toEqual(o)
    })
  })

  describe('invalid video protocol', () => {
    test('with invalid basic info', () => {
      const o = { ...videoProtocol, version: 'invalid' }
      expect(() => verify(o)).toThrowError(INVALID_VERSION)
    })

    test('with invalid frames segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [{ ...framesSegment, type: 'invalid' }] }] }
      expect(() => verify(o)).toThrowError(INVALID_FRAMES_SEGMENT_TYPE)
    })

    test('with invalid text segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'text', children: [{ ...textSegment, texts: '' }] }] }
      expect(() => verify(o)).toThrowError(generateTypeErrorPrefixReg('/texts', 'array'))
    })

    test('with invalid image segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'image', children: [{ ...imageSegment, format: 'invalid' }] }] }
      expect(() => verify(o)).toThrowError(INVALID_IMAGE_FORMAT)
    })

    test('with invalid audio segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'audio', children: [{ ...audioSegment, url: 'invalid' }] }] }
      expect(() => verify(o)).toThrowError(INVALID_URL)
    })

    test('with invalid effect segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'effect', children: [{ ...effectSegment, effectId: 1 }] }] }
      expect(() => verify(o)).toThrowError(generateTypeErrorPrefixReg('/effectId', 'string'))
    })

    test('with invalid filter segment', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'filter', children: [{ ...filterSegment, filterId: 1 }] }] }
      expect(() => verify(o)).toThrowError(generateTypeErrorPrefixReg('/filterId', 'string'))
    })

    test('with invalid track', () => {
      const o = { ...videoProtocol, tracks: [{ trackId: -1, trackType: 'frames', children: [framesSegment] }] }
      expect(() => verify(o)).toThrowError(INVALID_ID)
    })
  })

  describe('duplicate id', () => {
    test('duplicate track id', () => {
      const o: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [{ ...framesSegment }] }, { trackId: '1', trackType: 'frames', children: [{ ...framesSegment }] }] }
      expect(() => verify(o)).toThrowError(`${DUPLICATE_TRACK_ID} 1`)
    })

    test('duplicate segment id', () => {
      const o1: IVideoProtocol = { ...videoProtocol, tracks: [{ trackId: '1', trackType: 'frames', children: [{ ...framesSegment }, { ...framesSegment }] }] }
      expect(() => verify(o1)).toThrowError(`${DUPLICATE_SEGMENT_ID} 1`)
    })
  })
})
