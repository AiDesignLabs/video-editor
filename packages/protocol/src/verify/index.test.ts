import type { IVideoFramesSegment } from '@video-editor/shared'
import { INVALID_END_TIME, INVALID_FPS, INVALID_FRAMES_SEGMENT_TYPE, INVALID_HEIGHT, INVALID_ID, INVALID_START_TIME, INVALID_TRACKS, INVALID_URL, INVALID_VERSION, INVALID_WIDTH, TYPE_ERROR_FRAMES_SEGMENT, generateMissingRequiredReg } from './rules'
import { createVerify } from './index'

describe('verify basic info of video protocol', () => {
  const { verifyBasic } = createVerify()
  test('valid video protocol', () => {
    const videoProtocol = { version: '0.0.1', width: 500, height: 500, fps: 25, tracks: [] }
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
        const videoProtocol = { version: '0.0', width: 500, height: 500, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(INVALID_VERSION)
      })

      test('invalid width', () => {
        const videoProtocol = { version: '0.0.1', width: -1, height: 500, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(INVALID_WIDTH)
      })

      test('invalid height', () => {
        const videoProtocol = { version: '0.0.1', width: 500, height: -1, fps: 25, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(INVALID_HEIGHT)
      })

      test('invalid fps', () => {
        const videoProtocol = { version: '0.0.1', width: 500, height: 500, fps: -1, tracks: [] }
        expect(() => verifyBasic(videoProtocol)).toThrowError(INVALID_FPS)
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
    describe('valid frames segment', () => {
      test('valid video frames segment', () => {
        const videoFramesSegment: IVideoFramesSegment = { id: '1', startTime: 0, endTime: 500, type: 'video', url: 'https://example.com/video.mp4' }
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
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('type'))
        })

        test('with type image missing format', () => {
          const o = { id: '1', startTime: 0, endTime: 500, type: 'image', url: 'https://example.com/image.png' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg('format'))
        })

        test('missing multiple attributes', () => {
          const o = { id: '1', startTime: 0, type: 'video' }
          expect(() => verifyFramesSegment(o)).toThrowError(generateMissingRequiredReg(['endTime', 'url']))
        })

        test('missing all attributes', () => {
          expect(() => verifyFramesSegment({})).toThrowError(generateMissingRequiredReg(['id', 'startTime', 'endTime', 'type', 'url']))
        })
      })

      describe('invalid values', () => {
        test('invalid id', () => {
          const o = { id: 1, startTime: 0, endTime: 500, type: 'video', url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_ID)
        })

        test('invalid startTime', () => {
          const o = { id: '1', startTime: -1, endTime: 500, type: 'video', url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_START_TIME)
        })

        test('invalid endTime', () => {
          const o = { id: '1', startTime: 0, endTime: -1, type: 'video', url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_END_TIME)
        })

        test('invalid url', () => {
          const o = { id: '1', startTime: 0, endTime: 500, type: 'video', url: 1 }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_URL)
        })

        test('invalid type', () => {
          const o = { id: '1', startTime: 0, endTime: 500, type: 'invalid', url: 'https://example.com/video.mp4' }
          expect(() => verifyFramesSegment(o)).toThrowError(INVALID_FRAMES_SEGMENT_TYPE)
        })
      })
    })
  })
})
