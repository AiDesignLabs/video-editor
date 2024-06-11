import type { IImageSegment, ITextSegment, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { createVideoProtocolManager } from './index'

describe('video protocol basic info', () => {
  const protocol: IVideoProtocol = {
    version: '1.0.0',
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [],
  }
  const { videoBasicInfo } = createVideoProtocolManager(protocol)

  it('get', () => {
    expect(videoBasicInfo.version).toBe('1.0.0')
    expect(videoBasicInfo.width).toBe(1920)
    expect(videoBasicInfo.height).toBe(1080)
    expect(videoBasicInfo.fps).toBe(30)
  })

  describe('modify', () => {
    it('basic info', () => {
      videoBasicInfo.width = 1280
      videoBasicInfo.height = 720
      videoBasicInfo.fps = 60

      expect(videoBasicInfo.version).toBe('1.0.0')
      expect(videoBasicInfo.width).toBe(1280)
      expect(videoBasicInfo.height).toBe(720)
      expect(videoBasicInfo.fps).toBe(60)
    })

    it('version is readonly', () => {
      expect(() => videoBasicInfo.version = '1.0.1').toThrowError()
      expect(videoBasicInfo.version).toBe('1.0.0')
    })
  })
})

describe('video protocol segment curd', () => {
  const protocol: IVideoProtocol = {
    version: '1.0.0',
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [],
  }

  describe('add segment', () => {
    it('happy path', () => {
      const { selectedSegment, setSelectedSegment, segmentMap, trackMap, addSegment } = createVideoProtocolManager(protocol)
      const segment: IVideoFramesSegment = {
        id: '1',
        startTime: 0,
        endTime: 1000,
        segmentType: 'frames',
        type: 'video',
        url: 'http://example.com/video.mp4',
      }
      const insertId = addSegment(segment)
      expect(insertId).toBe('1')
      expect(segmentMap.value['1']).toEqual(segment)
      expect(trackMap.value.frames[0].children[0]).toEqual(segment)

      setSelectedSegment(addSegment(segment))
      expect(trackMap.value.frames[0].children[1].startTime).toEqual(1000)
      expect(selectedSegment.value?.startTime).toBe(1000)
    })

    describe('by current time', () => {
      it('with frames segment', () => {
        const { selectedSegment, setSelectedSegment, addSegment, curTime } = createVideoProtocolManager(protocol)
        const segment: IVideoFramesSegment = {
          id: '11',
          startTime: 0,
          endTime: 1000,
          segmentType: 'frames',
          type: 'video',
          url: 'http://example.com/video.mp4',
        }
        const insertId = addSegment(segment)
        setSelectedSegment(insertId)
        expect(insertId).toBe('11')
        expect(selectedSegment.value?.startTime).toBe(0)

        curTime.value = 1000
        setSelectedSegment(addSegment(segment))
        expect(selectedSegment.value?.startTime).toBe(1000)
      })

      it('with other segment', () => {
        const { selectedSegment, setSelectedSegment, addSegment, trackMap, curTime } = createVideoProtocolManager(protocol)
        const segment: ITextSegment = {
          id: '11',
          startTime: 0,
          endTime: 1000,
          segmentType: 'text',
          texts: [{ content: 'wendraw' }],
        }
        const insertId = addSegment(segment)
        setSelectedSegment(insertId)
        expect(insertId).toBe('11')
        expect(selectedSegment.value?.startTime).toBe(0)

        curTime.value = 500
        setSelectedSegment(addSegment(segment))
        expect(selectedSegment.value?.startTime).toBe(500)
        expect(trackMap.value.text).toHaveLength(2)
      })
    })

    describe('cross time', () => {
      it('with frames segment', () => {
        const { segmentMap, trackMap, addSegment } = createVideoProtocolManager(protocol)
        const segment: IVideoFramesSegment = {
          id: '1',
          startTime: 0,
          endTime: 1000,
          segmentType: 'frames',
          type: 'video',
          url: 'http://example.com/video.mp4',
        }
        const insertId = addSegment(segment)
        expect(insertId).toBe('1')
        const newId = addSegment({ ...segment, startTime: 500, endTime: 1500 })
        expect(trackMap.value.frames).toHaveLength(1)
        expect(segmentMap.value[newId]?.startTime).toBe(1000)
      })

      it('with other segment', () => {
        const { segmentMap, trackMap, addSegment } = createVideoProtocolManager(protocol)
        const segment: IImageSegment = {
          id: '1',
          startTime: 0,
          endTime: 1000,
          segmentType: 'image',
          format: 'img',
          url: 'http://example.com/image.jpg',
        }
        const insertId = addSegment(segment)
        expect(insertId).toBe('1')
        const newId = addSegment({ ...segment, startTime: 500, endTime: 1500 })
        expect(trackMap.value.image).toHaveLength(2)
        expect(segmentMap.value[newId]?.startTime).toBe(0)
      })
    })

    it('by same id', () => {
      const { segmentMap, addSegment } = createVideoProtocolManager(protocol)
      const segment: IVideoFramesSegment = {
        id: '1',
        startTime: 0,
        endTime: 1000,
        segmentType: 'frames',
        type: 'video',
        url: 'http://example.com/video.mp4',
      }
      const insertId = addSegment(segment)
      expect(insertId).toBe('1')
      expect(segmentMap.value[insertId]).toEqual({ ...segment, id: insertId })

      const insertId2 = addSegment(segment)
      expect(insertId2).not.toBe('1')
    })
  })

  it('remove segment', () => {
    const { segmentMap, trackMap, removeSegment, addSegment } = createVideoProtocolManager(protocol)
    const segment: IVideoFramesSegment = {
      id: '1',
      startTime: 0,
      endTime: 1000,
      segmentType: 'frames',
      type: 'video',
      url: 'http://example.com/video.mp4',
    }
    addSegment(segment)
    expect(removeSegment('1')).toBe(true)
    expect(removeSegment('1')).toBe(false)
    expect(segmentMap.value['1']).toBeUndefined()
    expect(trackMap.value.frames).toHaveLength(0)
  })

  describe('selected segment', () => {
    const { selectedSegment, setSelectedSegment, addSegment } = createVideoProtocolManager(protocol)
    const segment: IVideoFramesSegment = {
      id: '1',
      startTime: 0,
      endTime: 1000,
      segmentType: 'frames',
      type: 'video',
      url: 'http://example.com/video.mp4',
    }
    setSelectedSegment(addSegment(segment))

    it('clear', () => {
      expect(selectedSegment.value?.id).toEqual('1')
      setSelectedSegment(undefined)
      expect(selectedSegment.value).toBeUndefined()
    })

    it('set by id', () => {
      setSelectedSegment('1')
      expect(selectedSegment.value?.id).toEqual('1')
    })
  })

  describe('update segment', () => {
    describe('frames segment', () => {
      const { selectedSegment, segmentMap, updateSegment, setSelectedSegment, addSegment } = createVideoProtocolManager(protocol)
      const segment: IVideoFramesSegment = {
        id: '1',
        startTime: 0,
        endTime: 1000,
        segmentType: 'frames',
        type: 'video',
        url: 'http://example.com/video.mp4',
      }
      const video1Id = addSegment(segment)
      const video2Id = addSegment(segment)

      it('update time duration', () => {
        setSelectedSegment(video2Id)
        expect(selectedSegment.value?.id).toBe(video2Id)
        updateSegment((segment) => {
          segment.endTime = 2000
        })
        expect(selectedSegment.value!.endTime).toBe(2000)
        expect(segmentMap.value[video1Id]?.endTime).toBe(1000)

        setSelectedSegment(video1Id)
        expect(selectedSegment.value?.id).toBe(video1Id)
        updateSegment((segment) => {
          segment.endTime = 1500
        }, '1')
        expect(selectedSegment.value?.endTime).toBe(1500)
        expect(segmentMap.value[video2Id]?.startTime).toBe(1500)
        expect(segmentMap.value[video2Id]?.endTime).toBe(2500)
      })
    })
  })
})
