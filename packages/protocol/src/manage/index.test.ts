import type { IAudioSegment, IEffectSegment, IFilterSegment, IFramesSegmentUnion, IImageSegment, ITextSegment, ITransition, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { createVideoProtocolManager } from './index'

const protocol: IVideoProtocol = {
  version: '1.0.0',
  width: 1920,
  height: 1080,
  fps: 30,
  tracks: [],
}

describe('video protocol basic info', () => {
  const { videoBasicInfo, exportProtocol } = createVideoProtocolManager(protocol)

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
      expect(() => videoBasicInfo.version = '1.0.1').not.toThrowError()
      expect(videoBasicInfo.version).toBe('1.0.0')
    })

    it('export', () => {
      expect(exportProtocol()).toEqual({
        version: '1.0.0',
        width: 1280,
        height: 720,
        fps: 60,
        tracks: [],
      })
    })
  })
})

describe('video protocol segment curd', () => {
  describe('add segment', () => {
    it('happy path', () => {
      const { selectedSegment, curTime, setSelectedSegment, segmentMap, trackMap, addSegment } = createVideoProtocolManager(protocol)
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

      curTime.value = 1000
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
        const { selectedSegment, setSelectedSegment, addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)
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
        expect(segmentMap.value[insertId]?.id).toBe('11')
        expect(selectedSegment.value?.startTime).toBe(0)
        expect(selectedSegment.value?.id).toBe('11')

        curTime.value = 500
        const newId = addSegment(segment)
        setSelectedSegment(newId)
        expect(segmentMap.value[newId]?.id).toBe(newId)
        expect(selectedSegment.value?.id).toBe(newId)
        expect(selectedSegment.value?.startTime).toBe(500)
        expect(trackMap.value.text).toHaveLength(2)
      })
    })

    describe('cross time', () => {
      it('with frames segment', () => {
        const { segmentMap, trackMap, addSegment, curTime } = createVideoProtocolManager(protocol)
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
        curTime.value = 1000
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
    expect(trackMap.value.frames).toHaveLength(1)
    expect(segmentMap.value['1']?.id).toBe('1')
    expect(removeSegment('1')).toBe(true)
    expect(removeSegment('1')).toBe(false)
    expect(segmentMap.value['1']).toBeUndefined()
    expect(trackMap.value.frames).toBeUndefined()
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
      const { selectedSegment, curTime, segmentMap, updateSegment, setSelectedSegment, addSegment } = createVideoProtocolManager(protocol)
      const segment: IVideoFramesSegment = {
        id: '1',
        startTime: 0,
        endTime: 1000,
        segmentType: 'frames',
        type: 'video',
        url: 'http://example.com/video.mp4',
      }
      const video1Id = addSegment(segment)
      curTime.value = 1000
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

      it('update invalid url', () => {
        setSelectedSegment(video1Id)
        expect(selectedSegment.value?.id).toBe(video1Id)
        updateSegment((segment) => {
          segment.url = 'invalid url'
        })
        expect(selectedSegment.value?.url).toBe(segment.url)
        expect(segmentMap.value[video1Id]?.url).toBe(segment.url)
      })
    })
  })

  describe('export protocol', () => {
    it('happy path', () => {
      const { addSegment, exportProtocol } = createVideoProtocolManager(protocol)
      const segment: IVideoFramesSegment = {
        id: '1',
        startTime: 0,
        endTime: 1000,
        segmentType: 'frames',
        type: 'video',
        url: 'http://example.com/video.mp4',
      }
      expect(exportProtocol()).toEqual(protocol)

      const insertId = addSegment(segment)
      expect(insertId).toBe('1')

      expect(exportProtocol()).toEqual({
        version: '1.0.0',
        width: 1920,
        height: 1080,
        fps: 30,
        tracks: [
          {
            isMain: true,
            trackType: 'frames',
            trackId: expect.any(String),
            children: [segment],
          },
        ],
      })
    })

    it('with multiple track, have level index', () => {
      const { addSegment, exportProtocol } = createVideoProtocolManager(protocol)
      const imageSegment: IImageSegment = {
        id: '1',
        startTime: 0,
        endTime: 1000,
        segmentType: 'image',
        format: 'img',
        url: 'http://example.com/image.jpg',
      }
      const textSegment: ITextSegment = {
        id: '2',
        startTime: 0,
        endTime: 1000,
        segmentType: 'text',
        texts: [{ content: 'wendraw' }],
      }
      addSegment(imageSegment)
      addSegment(textSegment)
      addSegment(imageSegment)
      addSegment(textSegment)

      expect(exportProtocol().tracks.map(track => track.trackType)).toEqual(['image', 'text', 'image', 'text'])
    })
  })
})

describe('frames segment', () => {
  const segment: IVideoFramesSegment = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'frames',
    type: 'video',
    url: 'http://example.com/video.mp4',
  }

  describe('add', () => {
    const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)

    describe('happy path', () => {
      it('add segment', () => {
        const id = addSegment(segment)
        expect(id).toBe('1')
        expect(trackMap.value.frames).toHaveLength(1)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1000)
        expect(trackMap.value.frames).toHaveLength(1)
      })

      describe('cross time', () => {
        it('left half', () => {
          const { addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
          const id = addSegment(segment)
          const idLeft = addSegment(segment)

          expect(segmentMap.value[idLeft]?.startTime).toBe(0)
          expect(segmentMap.value[id]?.startTime).toBe(1000)
          expect(trackMap.value.frames).toHaveLength(1)
        })

        it('right half', () => {
          const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)
          const id = addSegment(segment)
          curTime.value = 600
          const idRight = addSegment(segment)
          expect(segmentMap.value[idRight]?.startTime).toBe(1000)
          expect(segmentMap.value[id]?.startTime).toBe(0)
          expect(trackMap.value.frames).toHaveLength(1)
        })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any)).toThrowError()
        // addSegment({} as any)
        expect(() => addSegment({} as any)).toThrowError()
      })
    })
  })

  describe('get', () => {
    const { addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('get', () => {
      expect(trackMap.value.frames).toHaveLength(1)
      expect(trackMap.value.frames[0].children[0]).toEqual(segment)
      expect(segmentMap.value['1']).toEqual(segment)
    })
  })

  describe('remove', () => {
    const { addSegment, segmentMap, trackMap, removeSegment } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('exist id', () => {
      expect(removeSegment('1')).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.frames).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { addSegment, segmentMap, updateSegment, curTime } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment)
      curTime.value = 1000
      const id2 = addSegment(segment)

      it('modify basic info', () => {
        updateSegment((segment) => {
          segment.url = 'http://example.com/video2.mp4'
        }, id1)
        expect(segmentMap.value[id1]?.url).toBe('http://example.com/video2.mp4')
      })

      it('modify endTime', () => {
        updateSegment((segment) => {
          segment.endTime = 3000
        }, id2)
        expect(segmentMap.value[id2]?.endTime).toBe(3000)

        updateSegment((segment) => {
          segment.endTime = 2000
        }, id1)

        expect(segmentMap.value[id1]?.endTime).toBe(2000)
        expect(segmentMap.value[id2]?.startTime).toBe(2000)
        expect(segmentMap.value[id2]?.endTime).toBe(4000)
      })
    })

    describe('bad path', () => {
      const { addSegment, updateSegment, segmentMap, undoCount } = createVideoProtocolManager(protocol)
      const id = addSegment(segment)

      expect(undoCount.value).toBe(1)

      it('invalid url', () => {
        updateSegment((segment) => {
          segment.url = 'invalid url'
        }, id)
        expect(segmentMap.value[id]?.url).toBe('http://example.com/video.mp4')
      })

      it('modify segmentType', () => {
        updateSegment((segment) => {
          // @ts-expect-error test error type
          segment.segmentType = 'invalid segmentType'
        }, id)
        updateSegment((segment) => {
          segment.segmentType = 'text'
        }, id)
        expect(segmentMap.value[id]?.segmentType).toBe('frames')
      })

      it('modify id', () => {
        updateSegment((segment) => {
          segment.id = 'invalid id'
        }, id)
        expect(undoCount.value).toBe(1)
        expect(segmentMap.value[id]?.id).toBe(id)
      })
    })
  })
})

describe('audio segment', () => {
  const segment: IAudioSegment = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'audio',
    url: 'http://example.com/audio.mp3',
  }

  describe('add', () => {
    const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)

    describe('happy path', () => {
      it('add segment', () => {
        const id = addSegment(segment)
        expect(id).toBe('1')
        expect(trackMap.value.audio).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.audio[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.audio).toHaveLength(1)
        expect(trackMap.value.audio[0].children[0]).toEqual(segment)
        expect(trackMap.value.audio[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.audio).toHaveLength(2)
        expect(trackMap.value.audio[1].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any)).toThrowError()
        // addSegment({} as any)
        expect(() => addSegment({} as any)).toThrowError()
      })
    })
  })

  describe('get', () => {
    const { addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('get', () => {
      expect(trackMap.value.audio).toHaveLength(1)
      expect(trackMap.value.audio[0].children[0]).toEqual(segment)
      expect(segmentMap.value['1']).toEqual(segment)
    })
  })

  describe('remove', () => {
    const { addSegment, segmentMap, trackMap, removeSegment } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('exist id', () => {
      expect(removeSegment('1')).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.audio).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment)
      curTime.value = 1000
      const id2 = addSegment(segment)
      curTime.value = 2000
      const id3 = addSegment(segment)

      it('modify basic info', () => {
        updateSegment((segment) => {
          segment.url = 'http://example.com/audio2.mp3'
        }, id1)
        expect(segmentMap.value[id1]?.url).toBe('http://example.com/audio2.mp3')
      })

      describe('modify endTime', () => {
        it('with last segment', () => {
          updateSegment((segment) => {
            segment.endTime = 4000
          }, id3)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(1000)
          expect(segmentMap.value[id2]?.startTime).toBe(1000)
          expect(segmentMap.value[id2]?.endTime).toBe(2000)
          expect(segmentMap.value[id3]?.startTime).toBe(2000)
          expect(segmentMap.value[id3]?.endTime).toBe(4000)
        })

        it('with middle segment', () => {
          updateSegment((segment) => {
            segment.endTime = 2000
          }, id1)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(2000)
          expect(segmentMap.value[id2]?.startTime).toBe(2000)
          expect(segmentMap.value[id2]?.endTime).toBe(3000)
          expect(segmentMap.value[id3]?.startTime).toBe(3000)
          expect(segmentMap.value[id3]?.endTime).toBe(5000)
        })
      })
    })

    describe('bad path', () => {
      const { addSegment, updateSegment, segmentMap, undoCount } = createVideoProtocolManager(protocol)
      const id = addSegment(segment)

      expect(undoCount.value).toBe(1)

      it('invalid url', () => {
        updateSegment((segment) => {
          segment.url = 'invalid url'
        }, id)
        expect(segmentMap.value[id]?.url).toBe('http://example.com/audio.mp3')
      })

      it('modify segmentType', () => {
        updateSegment((segment) => {
          // @ts-expect-error test error type
          segment.segmentType = 'invalid segmentType'
        }, id)
        updateSegment((segment) => {
          segment.segmentType = 'text'
        }, id)
        expect(segmentMap.value[id]?.segmentType).toBe('audio')
      })

      it('modify id', () => {
        updateSegment((segment) => {
          segment.id = 'invalid id'
        }, id)
        expect(undoCount.value).toBe(1)
        expect(segmentMap.value[id]?.id).toBe(id)
      })
    })
  })
})

describe('text segment', () => {
  const segment: ITextSegment = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'text',
    texts: [{ content: 'wendraw' }],
  }

  describe('add', () => {
    const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)

    describe('happy path', () => {
      it('add segment', () => {
        const id = addSegment(segment)
        expect(id).toBe('1')
        expect(trackMap.value.text).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.text[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.text).toHaveLength(1)
        expect(trackMap.value.text[0].children[0]).toEqual(segment)
        expect(trackMap.value.text[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.text).toHaveLength(2)
        expect(trackMap.value.text[1].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any)).toThrowError()
        // addSegment({} as any)
        expect(() => addSegment({} as any)).toThrowError()
      })
    })
  })

  describe('get', () => {
    const { getSegment, addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('get', () => {
      expect(trackMap.value.text).toHaveLength(1)
      expect(trackMap.value.text[0].children[0]).toEqual(segment)
      expect(segmentMap.value['1']).toEqual(segment)
      expect(getSegment('1', 'text')).toEqual(segment)
      expect(getSegment('1', 'text')?.texts).toEqual([{ content: 'wendraw' }])
      expect(getSegment('1')).toEqual(segment)
      expect(getSegment('1', 'frames')).toBeUndefined()
    })
  })

  describe('remove', () => {
    const { addSegment, segmentMap, trackMap, removeSegment } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('exist id', () => {
      expect(removeSegment('1')).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.text).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment)
      curTime.value = 1000
      const id2 = addSegment(segment)
      curTime.value = 2000
      const id3 = addSegment(segment)

      it('modify basic info', () => {
        updateSegment((segment) => {
          segment.texts = [{ content: 'wendraw2', fontSize: 20 }]
          segment.opacity = 0.5
        }, id1, 'text')
        expect(getSegment(id1, 'text')?.texts).toEqual([{ content: 'wendraw2', fontSize: 20 }])
        expect(getSegment(id1, 'text')?.opacity).toBe(0.5)
      })

      describe('modify endTime', () => {
        it('with last segment', () => {
          updateSegment((segment) => {
            segment.endTime = 4000
          }, id3)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(1000)
          expect(segmentMap.value[id2]?.startTime).toBe(1000)
          expect(segmentMap.value[id2]?.endTime).toBe(2000)
          expect(segmentMap.value[id3]?.startTime).toBe(2000)
          expect(segmentMap.value[id3]?.endTime).toBe(4000)
        })

        it('with middle segment', () => {
          updateSegment((segment) => {
            segment.endTime = 2000
          }, id1)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(2000)
          expect(segmentMap.value[id2]?.startTime).toBe(2000)
          expect(segmentMap.value[id2]?.endTime).toBe(3000)
          expect(segmentMap.value[id3]?.startTime).toBe(3000)
          expect(segmentMap.value[id3]?.endTime).toBe(5000)
        })
      })
    })

    describe('bad path', () => {
      const { addSegment, updateSegment, segmentMap, undoCount } = createVideoProtocolManager(protocol)
      const id = addSegment(segment)

      expect(undoCount.value).toBe(1)

      it('invalid url', () => {
        updateSegment((segment) => {
          segment.url = 'invalid url'
        }, id)
        expect(segmentMap.value[id]?.url).toBeUndefined()
      })

      it('modify segmentType', () => {
        updateSegment((segment) => {
          // @ts-expect-error test error type
          segment.segmentType = 'invalid segmentType'
        }, id)
        updateSegment((segment) => {
          segment.segmentType = 'text'
        }, id)
        expect(segmentMap.value[id]?.segmentType).toBe('text')
      })
    })
  })
})

describe('image segment', () => {
  const segment: IImageSegment = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'image',
    format: 'img',
    url: 'http://example.com/image.jpg',
  }

  describe('add', () => {
    const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)

    describe('happy path', () => {
      it('add segment', () => {
        const id = addSegment(segment)
        expect(id).toBe('1')
        expect(trackMap.value.image).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.image[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.image).toHaveLength(1)
        expect(trackMap.value.image[0].children[0]).toEqual(segment)
        expect(trackMap.value.image[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.image).toHaveLength(2)
        expect(trackMap.value.image[1].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any)).toThrowError()
        // addSegment({} as any)
        expect(() => addSegment({} as any)).toThrowError()
      })
    })
  })

  describe('get', () => {
    const { getSegment, addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('get', () => {
      expect(trackMap.value.image).toHaveLength(1)
      expect(trackMap.value.image[0].children[0]).toEqual(segment)
      expect(segmentMap.value['1']).toEqual(segment)
      expect(getSegment('1', 'image')).toEqual(segment)
      expect(getSegment('1', 'frames')).toBeUndefined()
    })
  })

  describe('remove', () => {
    const { addSegment, segmentMap, trackMap, removeSegment } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('exist id', () => {
      expect(removeSegment('1')).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.image).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment)
      curTime.value = 1000
      const id2 = addSegment(segment)
      curTime.value = 2000
      const id3 = addSegment(segment)

      it('modify basic info', () => {
        updateSegment((segment) => {
          segment.format = 'gif'
          segment.url = 'http://example.com/image2.gif'
          segment.fillMode = 'cover'
        }, id1, 'image')
        expect(getSegment(id1, 'image')?.url).toBe('http://example.com/image2.gif')
        expect(getSegment(id1, 'image')?.format).toBe('gif')
      })

      describe('modify endTime', () => {
        it('with last segment', () => {
          updateSegment((segment) => {
            segment.endTime = 4000
          }, id3)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(1000)
          expect(segmentMap.value[id2]?.startTime).toBe(1000)
          expect(segmentMap.value[id2]?.endTime).toBe(2000)
          expect(segmentMap.value[id3]?.startTime).toBe(2000)
          expect(segmentMap.value[id3]?.endTime).toBe(4000)
        })

        it('with middle segment', () => {
          updateSegment((segment) => {
            segment.endTime = 2000
          }, id1)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(2000)
          expect(segmentMap.value[id2]?.startTime).toBe(2000)
          expect(segmentMap.value[id2]?.endTime).toBe(3000)
          expect(segmentMap.value[id3]?.startTime).toBe(3000)
          expect(segmentMap.value[id3]?.endTime).toBe(5000)
        })
      })
    })

    describe('bad path', () => {
      const { addSegment, updateSegment, segmentMap, undoCount } = createVideoProtocolManager(protocol)
      const id = addSegment(segment)

      expect(undoCount.value).toBe(1)

      it('invalid url', () => {
        updateSegment((segment) => {
          segment.url = 'invalid url'
        }, id)
        expect(segmentMap.value[id]?.url).toBe('http://example.com/image.jpg')
      })

      it('modify segmentType', () => {
        updateSegment((segment) => {
          // @ts-expect-error test error type
          segment.segmentType = 'invalid segmentType'
        }, id)
        updateSegment((segment) => {
          segment.segmentType = 'text'
        }, id)
        expect(segmentMap.value[id]?.segmentType).toBe('image')
      })
    })
  })
})

describe('effect segment', () => {
  const segment: IEffectSegment = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'effect',
    effectId: 'effectId',
    name: 'effectName',
  }

  describe('add', () => {
    const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)

    describe('happy path', () => {
      it('add segment', () => {
        const id = addSegment(segment)
        expect(id).toBe('1')
        expect(trackMap.value.effect).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.effect[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.effect).toHaveLength(1)
        expect(trackMap.value.effect[0].children[0]).toEqual(segment)
        expect(trackMap.value.effect[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.effect).toHaveLength(2)
        expect(trackMap.value.effect[1].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any)).toThrowError()
        // addSegment({} as any)
        expect(() => addSegment({} as any)).toThrowError()
      })
    })
  })

  describe('get', () => {
    const { getSegment, addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('get', () => {
      expect(trackMap.value.effect).toHaveLength(1)
      expect(trackMap.value.effect[0].children[0]).toEqual(segment)
      expect(segmentMap.value['1']).toEqual(segment)
      expect(getSegment('1', 'effect')).toEqual(segment)
      expect(getSegment('1', 'effect')?.segmentType).toEqual('effect')
      expect(getSegment('1', 'frames')).toBeUndefined()
    })
  })

  describe('remove', () => {
    const { addSegment, segmentMap, trackMap, removeSegment } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('exist id', () => {
      expect(removeSegment('1')).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.effect).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment)
      curTime.value = 1000
      const id2 = addSegment(segment)
      curTime.value = 2000
      const id3 = addSegment(segment)

      it('modify basic info', () => {
        updateSegment((segment) => {
          segment.effectId = 'effectId2'
          segment.name = 'effectName2'
        }, id1, 'effect')
        expect(getSegment(id1, 'effect')?.effectId).toBe('effectId2')
        expect(getSegment(id1, 'effect')?.name).toBe('effectName2')
      })

      describe('modify endTime', () => {
        it('with last segment', () => {
          updateSegment((segment) => {
            segment.endTime = 4000
          }, id3)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(1000)
          expect(segmentMap.value[id2]?.startTime).toBe(1000)
          expect(segmentMap.value[id2]?.endTime).toBe(2000)
          expect(segmentMap.value[id3]?.startTime).toBe(2000)
          expect(segmentMap.value[id3]?.endTime).toBe(4000)
        })

        it('with middle segment', () => {
          updateSegment((segment) => {
            segment.endTime = 2000
          }, id1)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(2000)
          expect(segmentMap.value[id2]?.startTime).toBe(2000)
          expect(segmentMap.value[id2]?.endTime).toBe(3000)
          expect(segmentMap.value[id3]?.startTime).toBe(3000)
          expect(segmentMap.value[id3]?.endTime).toBe(5000)
        })
      })
    })

    describe('bad path', () => {
      const { addSegment, updateSegment, segmentMap, undoCount } = createVideoProtocolManager(protocol)
      const id = addSegment(segment)

      expect(undoCount.value).toBe(1)

      it('invalid url', () => {
        updateSegment((segment) => {
          segment.url = 'invalid url'
        }, id)
        expect(segmentMap.value[id]?.url).toBeUndefined()
      })

      it('modify segmentType', () => {
        updateSegment((segment) => {
          // @ts-expect-error test error type
          segment.segmentType = 'invalid segmentType'
        }, id)
        updateSegment((segment) => {
          segment.segmentType = 'text'
        }, id)
        expect(segmentMap.value[id]?.segmentType).toBe('effect')
      })
    })
  })
})

describe('filter segment', () => {
  const segment: IFilterSegment = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'filter',
    filterId: 'filterId',
    name: 'filterName',
  }

  describe('add', () => {
    const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)

    describe('happy path', () => {
      it('add segment', () => {
        const id = addSegment(segment)
        expect(id).toBe('1')
        expect(trackMap.value.filter).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.filter[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.filter).toHaveLength(1)
        expect(trackMap.value.filter[0].children[0]).toEqual(segment)
        expect(trackMap.value.filter[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment)
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.filter).toHaveLength(2)
        expect(trackMap.value.filter[1].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any)).toThrowError()
        // addSegment({} as any)
        expect(() => addSegment({} as any)).toThrowError()
      })
    })
  })

  describe('get', () => {
    const { getSegment, addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('get', () => {
      expect(trackMap.value.filter).toHaveLength(1)
      expect(trackMap.value.filter[0].children[0]).toEqual(segment)
      expect(segmentMap.value['1']).toEqual(segment)
      expect(getSegment('1', 'filter')).toEqual(segment)
      expect(getSegment('1', 'filter')?.segmentType).toEqual('filter')
      expect(getSegment('1', 'frames')).toBeUndefined()
    })
  })

  describe('remove', () => {
    const { addSegment, segmentMap, trackMap, removeSegment } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('exist id', () => {
      expect(removeSegment('1')).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.filter).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment)
      curTime.value = 1000
      const id2 = addSegment(segment)
      curTime.value = 2000
      const id3 = addSegment(segment)

      it('modify basic info', () => {
        updateSegment((segment) => {
          segment.filterId = 'filterId2'
          segment.name = 'filterName2'
        }, id1, 'filter')
        expect(getSegment(id1, 'filter')?.filterId).toBe('filterId2')
        expect(getSegment(id1, 'filter')?.name).toBe('filterName2')
      })

      describe('modify endTime', () => {
        it('with last segment', () => {
          updateSegment((segment) => {
            segment.endTime = 4000
          }, id3)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(1000)
          expect(segmentMap.value[id2]?.startTime).toBe(1000)
          expect(segmentMap.value[id2]?.endTime).toBe(2000)
          expect(segmentMap.value[id3]?.startTime).toBe(2000)
          expect(segmentMap.value[id3]?.endTime).toBe(4000)
        })

        it('with middle segment', () => {
          updateSegment((segment) => {
            segment.endTime = 2000
          }, id1)
          expect(segmentMap.value[id1]?.startTime).toBe(0)
          expect(segmentMap.value[id1]?.endTime).toBe(2000)
          expect(segmentMap.value[id2]?.startTime).toBe(2000)
          expect(segmentMap.value[id2]?.endTime).toBe(3000)
          expect(segmentMap.value[id3]?.startTime).toBe(3000)
          expect(segmentMap.value[id3]?.endTime).toBe(5000)
        })
      })
    })

    describe('bad path', () => {
      const { addSegment, updateSegment, segmentMap, undoCount } = createVideoProtocolManager(protocol)
      const id = addSegment(segment)

      expect(undoCount.value).toBe(1)

      it('invalid url', () => {
        updateSegment((segment) => {
          segment.url = 'invalid url'
        }, id)
        expect(segmentMap.value[id]?.url).toBeUndefined()
      })
    })
  })
})

describe('transition', () => {
  const transition: ITransition = {
    id: '1',
    name: 'transitionName',
    duration: 1000,
  }

  const videoSegment: IFramesSegmentUnion = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'frames',
    type: 'video',
    url: 'http://example.com/video.mp4',
  }

  describe('add', () => {
    describe('happy path', () => {
      const { addSegment, curTime, addTransition, getSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(videoSegment)
      curTime.value = 1000
      const id2 = addSegment(videoSegment)
      curTime.value = 2000
      const id3 = addSegment(videoSegment)

      it('add transition with left half time', () => {
        const added = addTransition(transition, 1100)
        expect(added).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toEqual(transition)
        expect(getSegment(id2, 'frames')?.transitionOut).toEqual(transition)
        expect(getSegment(id3, 'frames')?.transitionOut).toBeUndefined()
      })

      it('add transition with right half time', () => {
        curTime.value = 1501
        const added = addTransition(transition)
        expect(added).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toEqual(transition)
        expect(getSegment(id2, 'frames')?.transitionOut).toEqual(transition)
        expect(getSegment(id2, 'frames')?.transitionIn).toEqual(transition)
        expect(getSegment(id3, 'frames')?.transitionOut).toEqual(transition)
      })
    })

    describe('bad path', () => {
      it('frame segment length less than 2', () => {
        const { addSegment, addTransition } = createVideoProtocolManager(protocol)
        expect(addTransition(transition, 0)).toBe(false)
        addSegment(videoSegment)
        expect(addTransition(transition, 0)).toBe(false)
      })

      it('cross first segment left half time', () => {
        const { addSegment, addTransition, curTime, getSegment } = createVideoProtocolManager(protocol)
        const id1 = addSegment(videoSegment)
        curTime.value = 1000
        const id2 = addSegment(videoSegment)
        expect(addTransition(transition, 0)).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toEqual(transition)
        expect(getSegment(id2, 'frames')?.transitionOut).toEqual(transition)
      })

      it('cross last segment right half time', () => {
        const { addSegment, addTransition, curTime, getSegment } = createVideoProtocolManager(protocol)
        const id1 = addSegment(videoSegment)
        curTime.value = 1000
        const id2 = addSegment(videoSegment)
        expect(addTransition(transition, 2000)).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toEqual(transition)
        expect(getSegment(id2, 'frames')?.transitionOut).toEqual(transition)
      })

      it('invalid transition', () => {
        const { addSegment, addTransition, curTime, getSegment } = createVideoProtocolManager(protocol)
        const id1 = addSegment(videoSegment)
        curTime.value = 1000
        const id2 = addSegment(videoSegment)
        expect(addTransition({} as any)).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toBeUndefined()
        expect(getSegment(id2, 'frames')?.transitionOut).toBeUndefined()
      })
    })
  })

  describe('get', () => {
    const { addSegment, addTransition, getSegment, curTime } = createVideoProtocolManager(protocol)
    const id1 = addSegment(videoSegment)
    curTime.value = 501
    const id2 = addSegment(videoSegment)
    addTransition(transition)

    it('get', () => {
      expect(getSegment(id1, 'frames')?.transitionIn).toEqual(transition)
      expect(getSegment(id2, 'frames')?.transitionOut).toEqual(transition)
    })
  })

  describe('remove', () => {
    const { addSegment, addTransition, removeTransition, getSegment, curTime } = createVideoProtocolManager(protocol)
    const id1 = addSegment(videoSegment)
    curTime.value = 501
    const id2 = addSegment(videoSegment)
    addTransition(transition)

    it('exist id', () => {
      expect(removeTransition(id1)).toBe(true)
      expect(getSegment(id1, 'frames')?.transitionIn).toBeUndefined()
      expect(getSegment(id2, 'frames')?.transitionOut).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeTransition('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    const { addSegment, addTransition, updateTransition, getSegment, curTime } = createVideoProtocolManager(protocol)
    const id1 = addSegment(videoSegment)
    curTime.value = 501
    const id2 = addSegment(videoSegment)
    addTransition(transition)

    it('modify name', () => {
      updateTransition(id1, (transition) => {
        transition.name = 'transitionName2'
      })
      expect(getSegment(id1, 'frames')?.transitionIn?.name).toBe('transitionName2')
      expect(getSegment(id2, 'frames')?.transitionOut?.name).toBe('transitionName2')
    })

    it('modify duration', () => {
      updateTransition(id1, (transition) => {
        transition.duration = 2000
      })
      expect(getSegment(id1, 'frames')?.transitionIn?.duration).toBe(2000)
      expect(getSegment(id2, 'frames')?.transitionOut?.duration).toBe(2000)
    })
  })
})

describe('undo and redo', () => {
  const { addSegment, segmentMap, undo, redo, undoCount, redoCount } = createVideoProtocolManager(protocol)
  const segment: IFramesSegmentUnion = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'frames',
    type: 'video',
    url: 'http://example.com/video.mp4',
  }
  const id = addSegment(segment)

  it('undo', () => {
    expect(undoCount.value).toBe(1)
    expect(redoCount.value).toBe(0)
    expect(segmentMap.value[id]).toEqual(segment)
    undo()
    expect(segmentMap.value[id]).toBeUndefined()
    expect(undoCount.value).toBe(0)
    expect(redoCount.value).toBe(1)

    undo()
    expect(segmentMap.value[id]).toBeUndefined()
    expect(undoCount.value).toBe(0)
    expect(redoCount.value).toBe(1)
  })

  it('redo', () => {
    expect(undoCount.value).toBe(0)
    expect(redoCount.value).toBe(1)
    expect(segmentMap.value[id]).toBeUndefined()
    redo()
    expect(segmentMap.value[id]).toEqual(segment)
    expect(undoCount.value).toBe(1)
    expect(redoCount.value).toBe(0)

    redo()
    expect(segmentMap.value[id]).toEqual(segment)
    expect(undoCount.value).toBe(1)
    expect(redoCount.value).toBe(0)
  })

  it('undo and redo', () => {
    const id2 = addSegment(segment)
    expect(undoCount.value).toBe(2)
    expect(redoCount.value).toBe(0)
    expect(segmentMap.value[id2]).toEqual({ ...segment, id: id2 })

    undo()
    expect(segmentMap.value[id2]).toBeUndefined()
    expect(undoCount.value).toBe(1)
    expect(redoCount.value).toBe(1)

    const id3 = addSegment(segment)
    expect(undoCount.value).toBe(2)
    expect(redoCount.value).toBe(0)
    expect(segmentMap.value[id3]).toEqual({ ...segment, id: id3 })
  })
})
