import type { IVideoFramesSegment } from '@video-editor/shared'
import { INVALID_ANIMATION_TYPE, INVALID_END_TIME, INVALID_FPS, INVALID_FRAMES_SEGMENT_TYPE, INVALID_FROM_TIME, INVALID_HEIGHT, INVALID_ID, INVALID_IMAGE_FORMAT, INVALID_RGBA, INVALID_START_TIME, INVALID_TRACKS, INVALID_URL, INVALID_VERSION, INVALID_WIDTH, TYPE_ERROR_FRAMES_SEGMENT, generateMissingRequiredReg, generateTypeErrorPrefixReg } from './rules'
import { createVerify } from './index'

describe('verify basic info of video protocol', () => {
  const { verifyBasic } = createVerify()
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
  const { verifyFramesSegment } = createVerify()

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
            expect(() => verifyFramesSegment(o2)).toThrowErrorMatchingInlineSnapshot('[Error: data/transform must have required property \'rotation\', data/transform must have required property \'scale\', data/transform/position must NOT have more than 3 items]')
          })

          test('invalid type fillMode', () => {
            const o = { ...videoFramesSegment, fillMode: 'invalid' }
            expect(() => verifyFramesSegment(o)).toThrowErrorMatchingInlineSnapshot('[Error: data/fillMode must be equal to one of the allowed values]')
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
})
