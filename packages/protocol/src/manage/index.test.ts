import type { IAudioSegment, IEffectSegment, IFilterSegment, IFramesSegmentUnion, IImageFramesSegment, IStickerSegment, ITextSegment, ITransition, IVideoFramesSegment, IVideoProtocol } from '@video-editor/shared'
import { createVideoProtocolManager } from './index'

const protocol: IVideoProtocol = {
  id: 'protocol-1',
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
        id: 'protocol-1',
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
      const addResult = addSegment(segment)
      expect(addResult.id).toBe('1')
      expect(addResult.affectedSegments.map(seg => seg.id)).toEqual(['1'])
      expect(segmentMap.value['1']).toEqual(segment)
      expect(trackMap.value.frames[0].children[0]).toEqual(segment)

      curTime.value = 1000
      const secondResult = addSegment(segment)
      setSelectedSegment(secondResult.id)
      expect(secondResult.affectedSegments.map(seg => seg.id)).toEqual(['1', secondResult.id])
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
        const insertId = addSegment(segment).id
        setSelectedSegment(insertId)
        expect(insertId).toBe('11')
        expect(selectedSegment.value?.startTime).toBe(0)

        curTime.value = 1000
        setSelectedSegment(addSegment(segment).id)
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
        const addResult = addSegment(segment)
        setSelectedSegment(addResult.id)
        expect(addResult.id).toBe('11')
        expect(addResult.affectedSegments.map(seg => seg.id)).toEqual([addResult.id])
        expect(segmentMap.value[addResult.id]?.id).toBe('11')
        expect(selectedSegment.value?.startTime).toBe(0)
        expect(selectedSegment.value?.id).toBe('11')

        curTime.value = 500
        const newAddResult = addSegment(segment)
        setSelectedSegment(newAddResult.id)
        expect(segmentMap.value[newAddResult.id]?.id).toBe(newAddResult.id)
        expect(newAddResult.affectedSegments.map(seg => seg.id)).toEqual([newAddResult.id])
        expect(selectedSegment.value?.id).toBe(newAddResult.id)
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
        const insertId = addSegment(segment).id
        expect(insertId).toBe('1')
        curTime.value = 1000
        const newId = addSegment({ ...segment, startTime: 500, endTime: 1500 }).id
        expect(trackMap.value.frames).toHaveLength(1)
        expect(segmentMap.value[newId]?.startTime).toBe(1000)
      })

      it('reports affected segments when frames timeline is rebuilt', () => {
        const { addSegment, curTime } = createVideoProtocolManager(protocol)
        const baseSegment: IVideoFramesSegment = {
          id: 'clip-a',
          startTime: 0,
          endTime: 1000,
          segmentType: 'frames',
          type: 'video',
          url: 'http://example.com/video.mp4',
        }

        addSegment(baseSegment)
        curTime.value = 1000
        addSegment({ ...baseSegment, id: 'clip-b' })

        curTime.value = 500
        const result = addSegment({ ...baseSegment, id: 'clip-c', endTime: 500 })

        expect(result.affectedSegments.map(seg => ({
          id: seg.id,
          startTime: seg.startTime,
          endTime: seg.endTime,
        }))).toEqual([
          { id: 'clip-c', startTime: 500, endTime: 1000 },
        ])
      })

      it('with other segment', () => {
        const { segmentMap, trackMap, addSegment } = createVideoProtocolManager(protocol)
        const segment: IStickerSegment = {
          id: '1',
          startTime: 0,
          endTime: 1000,
          segmentType: 'sticker',
          format: 'img',
          url: 'http://example.com/image.jpg',
        }
        const insertId = addSegment(segment).id
        expect(insertId).toBe('1')
        const newId = addSegment({ ...segment, startTime: 500, endTime: 1500 }).id
        expect(trackMap.value.sticker).toHaveLength(2)
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
      const insertId = addSegment(segment).id
      expect(insertId).toBe('1')
      expect(segmentMap.value[insertId]).toEqual({ ...segment, id: insertId })

      const insertId2 = addSegment(segment).id
      expect(insertId2).not.toBe('1')
    })

    it('normalizes unordered initial tracks before inserting frames segment', () => {
      const unorderedProtocol: IVideoProtocol = {
        id: 'unordered-protocol',
        version: '1.0.0',
        width: 1280,
        height: 720,
        fps: 30,
        tracks: [
          {
            trackId: 'frames-track',
            trackType: 'frames',
            isMain: true,
            children: [
              {
                id: 'clip-b',
                segmentType: 'frames',
                type: 'video',
                url: 'http://example.com/clip-b.mp4',
                startTime: 3000,
                endTime: 6000,
              },
              {
                id: 'clip-c',
                segmentType: 'frames',
                type: 'image',
                format: 'img',
                url: 'http://example.com/clip-c.png',
                startTime: 6000,
                endTime: 9000,
              },
              {
                id: 'clip-a',
                segmentType: 'frames',
                type: 'image',
                format: 'img',
                url: 'http://example.com/clip-a.png',
                startTime: 0,
                endTime: 3000,
              },
            ],
          },
        ],
      }

      const { addSegment, trackMap, curTime } = createVideoProtocolManager(unorderedProtocol)
      const initialMainTrack = trackMap.value.frames?.find(track => track.isMain)

      expect(initialMainTrack?.children.map(segment => segment.id)).toEqual(['clip-a', 'clip-b', 'clip-c'])

      curTime.value = initialMainTrack?.children.at(-1)?.endTime ?? 0
      const newSegment: IImageFramesSegment = {
        id: 'clip-d',
        segmentType: 'frames',
        type: 'image',
        format: 'img',
        url: 'http://example.com/clip-d.png',
        startTime: 0,
        endTime: 2000,
      }
      const newId = addSegment(newSegment).id

      const framesTrack = trackMap.value.frames?.find(track => track.isMain)
      expect(framesTrack?.children.map(segment => segment.id)).toEqual(['clip-a', 'clip-b', 'clip-c', newId])
      expect(framesTrack?.children.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
        [0, 3000],
        [3000, 6000],
        [6000, 9000],
        [9000, 11000],
      ])
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
    expect(removeSegment('1').success).toBe(true)
    expect(removeSegment('1').success).toBe(false)
    expect(segmentMap.value['1']).toBeUndefined()
    expect(trackMap.value.frames).toHaveLength(1)
    expect(trackMap.value.frames[0].children).toHaveLength(0)
  })

  it('returns affected segments when removing from main frames track', () => {
    const { trackMap, removeSegment, addSegment, curTime } = createVideoProtocolManager(protocol)
    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      startTime: 0,
      endTime: 1000,
      segmentType: 'frames',
      type: 'video',
      url: 'http://example.com/video.mp4',
    }
    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      startTime: 0,
      endTime: 1000,
      segmentType: 'frames',
      type: 'video',
      url: 'http://example.com/video2.mp4',
    }

    addSegment(frame1)
    curTime.value = 1000
    addSegment(frame2)

    const result = removeSegment('frame-1')
    expect(result.success).toBe(true)
    expect(result.affectedSegments.map(seg => ({
      id: seg.id,
      startTime: seg.startTime,
      endTime: seg.endTime,
    }))).toEqual([
      { id: 'frame-2', startTime: 0, endTime: 1000 },
    ])
    expect(trackMap.value.frames?.[0].children.map(({ id, startTime, endTime }) => ({ id, startTime, endTime }))).toEqual([
      { id: 'frame-2', startTime: 0, endTime: 1000 },
    ])
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
    setSelectedSegment(addSegment(segment).id)

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
      const video1Id = addSegment(segment).id
      curTime.value = 1000
      const video2Id = addSegment(segment).id

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

      const insertId = addSegment(segment).id
      expect(insertId).toBe('1')

      expect(exportProtocol()).toEqual({
        id: 'protocol-1',
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
      const stickerSegment: IStickerSegment = {
        id: '1',
        startTime: 0,
        endTime: 1000,
        segmentType: 'sticker',
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
      addSegment(stickerSegment)
      addSegment(textSegment)
      addSegment(stickerSegment)
      addSegment(textSegment)
      expect(exportProtocol().tracks.map(track => track.trackType)).toEqual(['text', 'sticker', 'text', 'sticker'])
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
        const id = addSegment(segment).id
        expect(id).toBe('1')
        expect(trackMap.value.frames).toHaveLength(1)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.frames).toHaveLength(1)
      })

      describe('cross time', () => {
        it('left half', () => {
          const { addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
          const id = addSegment(segment).id
          const idLeft = addSegment(segment).id

          expect(segmentMap.value[idLeft]?.startTime).toBe(0)
          expect(segmentMap.value[id]?.startTime).toBe(0)
          expect(trackMap.value.frames).toHaveLength(2)
        })

        it('right half', () => {
          const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)
          const id = addSegment(segment).id
          curTime.value = 600
          const idRight = addSegment(segment).id
          expect(segmentMap.value[idRight]?.startTime).toBe(600)
          expect(segmentMap.value[id]?.startTime).toBe(0)
          expect(trackMap.value.frames).toHaveLength(2)
        })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any).id).toThrowError()
        // addSegment({} as any).id
        expect(() => addSegment({} as any).id).toThrowError()
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
      expect(removeSegment('1').success).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.frames).toHaveLength(1)
      expect(trackMap.value.frames[0].children).toHaveLength(0)
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id').success).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { addSegment, segmentMap, updateSegment, curTime } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment).id
      curTime.value = 1000
      const id2 = addSegment(segment).id

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
      const id = addSegment(segment).id

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
        const id = addSegment(segment).id
        expect(id).toBe('1')
        expect(trackMap.value.audio).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.audio[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.audio).toHaveLength(1)
        expect(trackMap.value.audio[0].children[0]).toEqual(segment)
        expect(trackMap.value.audio[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.audio).toHaveLength(2)
        expect(trackMap.value.audio[0].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any).id).toThrowError()
        // addSegment({} as any).id
        expect(() => addSegment({} as any).id).toThrowError()
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
      expect(removeSegment('1').success).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.audio).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id').success).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment).id
      curTime.value = 1000
      const id2 = addSegment(segment).id
      curTime.value = 2000
      const id3 = addSegment(segment).id

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
      const id = addSegment(segment).id

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
        const id = addSegment(segment).id
        expect(id).toBe('1')
        expect(trackMap.value.text).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.text[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.text).toHaveLength(1)
        expect(trackMap.value.text[0].children[0]).toEqual(segment)
        expect(trackMap.value.text[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.text).toHaveLength(2)
        expect(trackMap.value.text[0].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any).id).toThrowError()
        // addSegment({} as any).id
        expect(() => addSegment({} as any).id).toThrowError()
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
      expect(removeSegment('1').success).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.text).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id').success).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment).id
      curTime.value = 1000
      const id2 = addSegment(segment).id
      curTime.value = 2000
      const id3 = addSegment(segment).id

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
      const id = addSegment(segment).id

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

describe('sticker segment', () => {
  const segment: IStickerSegment = {
    id: '1',
    startTime: 0,
    endTime: 1000,
    segmentType: 'sticker',
    format: 'img',
    url: 'http://example.com/image.jpg',
  }

  describe('add', () => {
    const { addSegment, segmentMap, trackMap, curTime } = createVideoProtocolManager(protocol)

    describe('happy path', () => {
      it('add segment', () => {
        const id = addSegment(segment).id
        expect(id).toBe('1')
        expect(trackMap.value.sticker).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.sticker[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.sticker).toHaveLength(1)
        expect(trackMap.value.sticker[0].children[0]).toEqual(segment)
        expect(trackMap.value.sticker[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.sticker).toHaveLength(2)
        expect(trackMap.value.sticker[0].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any).id).toThrowError()
        // addSegment({} as any).id
        expect(() => addSegment({} as any).id).toThrowError()
      })
    })
  })

  describe('get', () => {
    const { getSegment, addSegment, segmentMap, trackMap } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('get', () => {
      expect(trackMap.value.sticker).toHaveLength(1)
      expect(trackMap.value.sticker[0].children[0]).toEqual(segment)
      expect(segmentMap.value['1']).toEqual(segment)
      expect(getSegment('1', 'sticker')).toEqual(segment)
      expect(getSegment('1', 'frames')).toBeUndefined()
    })
  })

  describe('remove', () => {
    const { addSegment, segmentMap, trackMap, removeSegment } = createVideoProtocolManager(protocol)
    addSegment(segment)
    it('exist id', () => {
      expect(removeSegment('1').success).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.sticker).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id').success).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment).id
      curTime.value = 1000
      const id2 = addSegment(segment).id
      curTime.value = 2000
      const id3 = addSegment(segment).id

      it('modify basic info', () => {
        updateSegment((segment) => {
          segment.format = 'gif'
          segment.url = 'http://example.com/image2.gif'
          segment.fillMode = 'cover'
        }, id1, 'sticker')
        expect(getSegment(id1, 'sticker')?.url).toBe('http://example.com/image2.gif')
        expect(getSegment(id1, 'sticker')?.format).toBe('gif')
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
      const id = addSegment(segment).id

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
        expect(segmentMap.value[id]?.segmentType).toBe('sticker')
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
        const id = addSegment(segment).id
        expect(id).toBe('1')
        expect(trackMap.value.effect).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.effect[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.effect).toHaveLength(1)
        expect(trackMap.value.effect[0].children[0]).toEqual(segment)
        expect(trackMap.value.effect[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.effect).toHaveLength(2)
        expect(trackMap.value.effect[0].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any).id).toThrowError()
        // addSegment({} as any).id
        expect(() => addSegment({} as any).id).toThrowError()
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
      expect(removeSegment('1').success).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.effect).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id').success).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment).id
      curTime.value = 1000
      const id2 = addSegment(segment).id
      curTime.value = 2000
      const id3 = addSegment(segment).id

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
      const id = addSegment(segment).id

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
        const id = addSegment(segment).id
        expect(id).toBe('1')
        expect(trackMap.value.filter).toHaveLength(1)
        expect(segmentMap.value[id]?.id).toBe('1')
        expect(trackMap.value.filter[0].children[0]).toEqual(segment)
      })

      it('add segment by current time', () => {
        curTime.value = 1100
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.filter).toHaveLength(1)
        expect(trackMap.value.filter[0].children[0]).toEqual(segment)
        expect(trackMap.value.filter[0].children[1]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })

      it('cross time', () => {
        const id = addSegment(segment).id
        expect(segmentMap.value[id]?.startTime).toBe(1100)
        expect(trackMap.value.filter).toHaveLength(2)
        expect(trackMap.value.filter[0].children[0]).toEqual({ ...segment, id, startTime: 1100, endTime: 2100 })
      })
    })

    describe('bad path', () => {
      it('invalid segment', () => {
        expect(() => addSegment(null as any).id).toThrowError()
        // addSegment({} as any).id
        expect(() => addSegment({} as any).id).toThrowError()
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
      expect(removeSegment('1').success).toBe(true)
      expect(segmentMap.value['1']).toBeUndefined()
      expect(trackMap.value.filter).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeSegment('not exist id').success).toBe(false)
    })
  })

  describe('modify', () => {
    describe('happy path', () => {
      const { curTime, getSegment, addSegment, segmentMap, updateSegment } = createVideoProtocolManager(protocol)
      const id1 = addSegment(segment).id
      curTime.value = 1000
      const id2 = addSegment(segment).id
      curTime.value = 2000
      const id3 = addSegment(segment).id

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
      const id = addSegment(segment).id

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
      const id1 = addSegment(videoSegment).id
      curTime.value = 1000
      const id2 = addSegment(videoSegment).id
      curTime.value = 2000
      const id3 = addSegment(videoSegment).id

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
        const id1 = addSegment(videoSegment).id
        curTime.value = 1000
        const id2 = addSegment(videoSegment).id
        expect(addTransition(transition, 0)).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toEqual(transition)
        expect(getSegment(id2, 'frames')?.transitionOut).toEqual(transition)
      })

      it('cross last segment right half time', () => {
        const { addSegment, addTransition, curTime, getSegment } = createVideoProtocolManager(protocol)
        const id1 = addSegment(videoSegment).id
        curTime.value = 1000
        const id2 = addSegment(videoSegment).id
        expect(addTransition(transition, 2000)).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toEqual(transition)
        expect(getSegment(id2, 'frames')?.transitionOut).toEqual(transition)
      })

      it('invalid transition', () => {
        const { addSegment, addTransition, curTime, getSegment } = createVideoProtocolManager(protocol)
        const id1 = addSegment(videoSegment).id
        curTime.value = 1000
        const id2 = addSegment(videoSegment).id
        expect(addTransition({} as any)).toBe(true)
        expect(getSegment(id1, 'frames')?.transitionIn).toBeUndefined()
        expect(getSegment(id2, 'frames')?.transitionOut).toBeUndefined()
      })
    })
  })

  describe('get', () => {
    const { addSegment, addTransition, getSegment, curTime } = createVideoProtocolManager(protocol)
    const id1 = addSegment(videoSegment).id
    curTime.value = 501
    const id2 = addSegment(videoSegment).id
    addTransition(transition)

    it('get', () => {
      expect(getSegment(id1, 'frames')?.transitionIn).toBeUndefined()
      expect(getSegment(id2, 'frames')?.transitionOut).toBeUndefined()
    })
  })

  describe('remove', () => {
    const { addSegment, addTransition, removeTransition, getSegment, curTime } = createVideoProtocolManager(protocol)
    const id1 = addSegment(videoSegment).id
    curTime.value = 501
    const id2 = addSegment(videoSegment).id
    addTransition(transition)

    it('exist id', () => {
      expect(removeTransition(id1)).toBe(false)
      expect(getSegment(id1, 'frames')?.transitionIn).toBeUndefined()
      expect(getSegment(id2, 'frames')?.transitionOut).toBeUndefined()
    })

    it('not exist id', () => {
      expect(removeTransition('not exist id')).toBe(false)
    })
  })

  describe('modify', () => {
    const { addSegment, addTransition, updateTransition, curTime } = createVideoProtocolManager(protocol)
    const id1 = addSegment(videoSegment).id
    curTime.value = 501
    addSegment(videoSegment)
    addTransition(transition)

    it('modify name', () => {
      expect(() => updateTransition(id1, (transition) => {
        transition.name = 'transitionName2'
      })).toThrowError()
    })

    it('modify duration', () => {
      expect(() => updateTransition(id1, (transition) => {
        transition.duration = 2000
      })).toThrowError()
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
  const id = addSegment(segment).id

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
    const id2 = addSegment(segment).id
    expect(undoCount.value).toBe(2)
    expect(redoCount.value).toBe(0)
    expect(segmentMap.value[id2]).toEqual({ ...segment, id: id2 })

    undo()
    expect(segmentMap.value[id2]).toBeUndefined()
    expect(undoCount.value).toBe(1)
    expect(redoCount.value).toBe(1)

    const id3 = addSegment(segment).id
    expect(undoCount.value).toBe(2)
    expect(redoCount.value).toBe(0)
    expect(segmentMap.value[id3]).toEqual({ ...segment, id: id3 })
  })
})

describe('moveSegment', () => {
  it('should move segment within same track', () => {
    const { addSegment, moveSegment, exportProtocol, curTime } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    const text2: ITextSegment = {
      id: 'text-2',
      segmentType: 'text',
      startTime: 1000,
      endTime: 2000,
      texts: [{ content: 'Text 2' }],
    }

    addSegment(text1)
    curTime.value = 1000
    addSegment(text2)
    const p1 = exportProtocol()
    const track = p1.tracks[0]

    // Move text-1 to overlap with text-2
    // text-2 is at 1000-2000, moving text-1 to 1500-2500 causes overlap
    // Expected: text-1 should be pushed to 2000-3000 to avoid overlap
    const moveResult = moveSegment({
      segmentId: 'text-1',
      sourceTrackId: track.trackId,
      targetTrackId: track.trackId,
      startTime: 1500,
      endTime: 2500,
    })
    expect(moveResult.success).toBe(true)
    expect(moveResult.affectedSegments.map(seg => ({
      id: seg.id,
      startTime: seg.startTime,
      endTime: seg.endTime,
    }))).toEqual([
      { id: 'text-2', startTime: 1000, endTime: 2000 },
      { id: 'text-1', startTime: 2000, endTime: 3000 },
    ])

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(1)
    expect(p2.tracks[0].children).toHaveLength(2)
    expect(p2.tracks[0].children[0].id).toBe('text-2')
    expect(p2.tracks[0].children[0].startTime).toBe(1000)
    expect(p2.tracks[0].children[0].endTime).toBe(2000)
    expect(p2.tracks[0].children[1].id).toBe('text-1')
    expect(p2.tracks[0].children[1].startTime).toBe(2000) // Pushed to avoid overlap
    expect(p2.tracks[0].children[1].endTime).toBe(3000) // Duration preserved (1000ms)
  })

  it('should move segment to new track', () => {
    const { addSegment, moveSegment, exportProtocol } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    addSegment(text1)
    const p1 = exportProtocol()
    const sourceTrack = p1.tracks[0]

    // Move to new track
    const moveResult = moveSegment({
      segmentId: 'text-1',
      sourceTrackId: sourceTrack.trackId,
      startTime: 500,
      endTime: 1500,
      isNewTrack: true,
      newTrackInsertIndex: 0,
    })
    expect(moveResult.success).toBe(true)
    expect(moveResult.affectedSegments.map(seg => seg.id)).toEqual(['text-1'])

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(1) // Old track deleted, new track created
    expect(p2.tracks[0].children).toHaveLength(1)
    expect(p2.tracks[0].children[0].startTime).toBe(500)
    expect(p2.tracks[0].children[0].endTime).toBe(1500)
  })

  it('returns affected segments when moving between existing tracks', () => {
    const { addSegment, moveSegment, exportProtocol, curTime } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    const text2: ITextSegment = {
      id: 'text-2',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 2' }],
    }

    const text3: ITextSegment = {
      id: 'text-3',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 3' }],
    }

    addSegment(text1)
    curTime.value = 500
    addSegment(text2) // overlaps, should create new text track
    curTime.value = 1000
    addSegment(text3)

    const p1 = exportProtocol()
    const sourceTrack = p1.tracks.find(track => track.children.some(seg => seg.id === 'text-1'))!
    const targetTrack = p1.tracks.find(track => track.children.some(seg => seg.id === 'text-2'))!

    const moveResult = moveSegment({
      segmentId: 'text-1',
      sourceTrackId: sourceTrack.trackId,
      targetTrackId: targetTrack.trackId,
      startTime: 0,
      endTime: 1000,
    })

    expect(moveResult.success).toBe(true)
    expect(moveResult.affectedSegments.map(seg => ({
      id: seg.id,
      startTime: seg.startTime,
      endTime: seg.endTime,
    }))).toEqual([
      { id: 'text-3', startTime: 1000, endTime: 2000 },
      { id: 'text-1', startTime: 0, endTime: 1000 },
      { id: 'text-2', startTime: 1000, endTime: 2000 },
    ])

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(2)
    const updatedSource = p2.tracks.find(track => track.trackId === sourceTrack.trackId)
    const updatedTarget = p2.tracks.find(track => track.trackId === targetTrack.trackId)
    expect(updatedSource?.children.map(({ id, startTime, endTime }) => ({ id, startTime, endTime }))).toEqual([
      { id: 'text-3', startTime: 1000, endTime: 2000 },
    ])
    expect(updatedTarget?.children.map(({ id, startTime, endTime }) => ({ id, startTime, endTime }))).toEqual([
      { id: 'text-1', startTime: 0, endTime: 1000 },
      { id: 'text-2', startTime: 1000, endTime: 2000 },
    ])
  })

  it('should handle frames track correctly', () => {
    const { addSegment, moveSegment, exportProtocol, curTime } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame3: IVideoFramesSegment = {
      id: 'frame-3',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video3.mp4',
      startTime: 0,
      endTime: 1000,
    }

    addSegment(frame1)
    curTime.value = 1000
    addSegment(frame2)
    curTime.value = 2000
    addSegment(frame3)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children[0].startTime).toBe(0)
    expect(p1.tracks[0].children[0].endTime).toBe(1000)
    expect(p1.tracks[0].children[1].startTime).toBe(1000)
    expect(p1.tracks[0].children[1].endTime).toBe(2000)
    expect(p1.tracks[0].children[2].startTime).toBe(2000)
    expect(p1.tracks[0].children[2].endTime).toBe(3000)

    const track = p1.tracks[0]

    // Move frame-2 to new track
    const moveResultFrames = moveSegment({
      segmentId: 'frame-2',
      sourceTrackId: track.trackId,
      startTime: 500,
      endTime: 1500,
      isNewTrack: true,
      newTrackInsertIndex: 1,
    })
    expect(moveResultFrames.success).toBe(true)
    expect(moveResultFrames.affectedSegments.map(seg => ({
      id: seg.id,
      startTime: seg.startTime,
      endTime: seg.endTime,
    }))).toEqual([
      { id: 'frame-1', startTime: 0, endTime: 1000 },
      { id: 'frame-3', startTime: 1000, endTime: 2000 },
      { id: 'frame-2', startTime: 500, endTime: 1500 },
    ])

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(2)

    // Original track should adjust frame-3's time
    expect(p2.tracks[0].children).toHaveLength(2)
    expect(p2.tracks[0].children[0].id).toBe('frame-1')
    expect(p2.tracks[0].children[0].startTime).toBe(0)
    expect(p2.tracks[0].children[0].endTime).toBe(1000)
    expect(p2.tracks[0].children[1].id).toBe('frame-3')
    expect(p2.tracks[0].children[1].startTime).toBe(1000) // Adjusted
    expect(p2.tracks[0].children[1].endTime).toBe(2000) // Adjusted

    // New track
    expect(p2.tracks[1].children).toHaveLength(1)
    expect(p2.tracks[1].children[0].id).toBe('frame-2')
  })

  it('reports track creation/removal and supports replacing trackId', () => {
    const { addSegment, moveSegment, exportProtocol, replaceTrackId } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    const addResult = addSegment(text1)
    expect(addResult.createdTracks).toHaveLength(1)
    const initialTrackId = addResult.createdTracks[0].trackId

    const moveResult = moveSegment({
      segmentId: 'text-1',
      sourceTrackId: initialTrackId,
      startTime: 0,
      endTime: 1000,
      isNewTrack: true,
      newTrackInsertIndex: 0,
    })

    expect(moveResult.createdTracks).toHaveLength(1)
    expect(moveResult.removedTrackIds).toContain(initialTrackId)
    const newTrackId = moveResult.createdTracks[0].trackId

    replaceTrackId(newTrackId, 'server-track-id')
    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(1)
    expect(p2.tracks[0].trackId).toBe('server-track-id')
    expect(p2.tracks[0].children[0].id).toBe('text-1')
  })

  it('supports replacing segment id', () => {
    const { addSegment, exportProtocol, replaceSegmentId } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    addSegment(text1)
    expect(replaceSegmentId('text-1', 'server-segment-id')).toBe(true)

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(1)
    expect(p2.tracks[0].children[0].id).toBe('server-segment-id')
  })
})

describe('moveSegment - undo/redo', () => {
  it('should support undo/redo for moving segment within same track', () => {
    const { addSegment, moveSegment, exportProtocol, curTime, undo, redo } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    const text2: ITextSegment = {
      id: 'text-2',
      segmentType: 'text',
      startTime: 1000,
      endTime: 2000,
      texts: [{ content: 'Text 2' }],
    }

    addSegment(text1)
    curTime.value = 1000
    addSegment(text2)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children[0].id).toBe('text-1')
    expect(p1.tracks[0].children[0].startTime).toBe(0)
    expect(p1.tracks[0].children[1].id).toBe('text-2')
    expect(p1.tracks[0].children[1].startTime).toBe(1000)

    const track = p1.tracks[0]

    // Move text-1 causing overlap
    moveSegment({
      segmentId: 'text-1',
      sourceTrackId: track.trackId,
      targetTrackId: track.trackId,
      startTime: 1500,
      endTime: 2500,
    })

    const p2 = exportProtocol()
    expect(p2.tracks[0].children[0].id).toBe('text-2')
    expect(p2.tracks[0].children[0].startTime).toBe(1000)
    expect(p2.tracks[0].children[1].id).toBe('text-1')
    expect(p2.tracks[0].children[1].startTime).toBe(2000) // Pushed to avoid overlap

    // Undo should restore original state
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks[0].children[0].id).toBe('text-1')
    expect(p3.tracks[0].children[0].startTime).toBe(0)
    expect(p3.tracks[0].children[1].id).toBe('text-2')
    expect(p3.tracks[0].children[1].startTime).toBe(1000)

    // Redo should reapply the move
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks[0].children[0].id).toBe('text-2')
    expect(p4.tracks[0].children[0].startTime).toBe(1000)
    expect(p4.tracks[0].children[1].id).toBe('text-1')
    expect(p4.tracks[0].children[1].startTime).toBe(2000)
  })

  it('should support undo/redo for moving segment to new track', () => {
    const { addSegment, moveSegment, exportProtocol, undo, redo } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    addSegment(text1)
    const p1 = exportProtocol()
    expect(p1.tracks).toHaveLength(1)
    expect(p1.tracks[0].children).toHaveLength(1)

    const sourceTrack = p1.tracks[0]

    // Move to new track
    moveSegment({
      segmentId: 'text-1',
      sourceTrackId: sourceTrack.trackId,
      startTime: 500,
      endTime: 1500,
      isNewTrack: true,
      newTrackInsertIndex: 0,
    })

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(1) // Old track deleted, new track created
    expect(p2.tracks[0].children[0].startTime).toBe(500)

    // Undo should restore original state
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks).toHaveLength(1)
    expect(p3.tracks[0].children[0].id).toBe('text-1')
    expect(p3.tracks[0].children[0].startTime).toBe(0)
    expect(p3.tracks[0].children[0].endTime).toBe(1000)

    // Redo should recreate the new track
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks).toHaveLength(1)
    expect(p4.tracks[0].children[0].startTime).toBe(500)
    expect(p4.tracks[0].children[0].endTime).toBe(1500)
  })

  it('should support undo/redo for moving frames segment', () => {
    const { addSegment, moveSegment, exportProtocol, curTime, undo, redo } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame3: IVideoFramesSegment = {
      id: 'frame-3',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video3.mp4',
      startTime: 0,
      endTime: 1000,
    }

    addSegment(frame1)
    curTime.value = 1000
    addSegment(frame2)
    curTime.value = 2000
    addSegment(frame3)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children).toHaveLength(3)
    expect(p1.tracks[0].children[0].startTime).toBe(0)
    expect(p1.tracks[0].children[1].startTime).toBe(1000)
    expect(p1.tracks[0].children[2].startTime).toBe(2000)

    const track = p1.tracks[0]

    // Move frame-2 to new track
    moveSegment({
      segmentId: 'frame-2',
      sourceTrackId: track.trackId,
      startTime: 500,
      endTime: 1500,
      isNewTrack: true,
      newTrackInsertIndex: 1,
    })

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(2)
    expect(p2.tracks[0].children).toHaveLength(2) // frame-1 and frame-3
    expect(p2.tracks[1].children).toHaveLength(1) // frame-2

    // Undo should restore all frames to original track
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks).toHaveLength(1)
    expect(p3.tracks[0].children).toHaveLength(3)
    expect(p3.tracks[0].children[0].id).toBe('frame-1')
    expect(p3.tracks[0].children[1].id).toBe('frame-2')
    expect(p3.tracks[0].children[2].id).toBe('frame-3')

    // Redo should recreate the new track
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks).toHaveLength(2)
    expect(p4.tracks[0].children).toHaveLength(2)
    expect(p4.tracks[1].children).toHaveLength(1)
  })
})

describe('resizeSegment', () => {
  it('should resize text segment', () => {
    const { addSegment, resizeSegment, exportProtocol } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    addSegment(text1)
    const p1 = exportProtocol()
    const track = p1.tracks[0]

    const result = resizeSegment({
      segmentId: 'text-1',
      trackId: track.trackId,
      startTime: 500,
      endTime: 2000,
    })
    expect(result.success).toBe(true)
    expect(result.affectedSegments.map(seg => ({
      id: seg.id,
      startTime: seg.startTime,
      endTime: seg.endTime,
    }))).toEqual([
      { id: 'text-1', startTime: 500, endTime: 2000 },
    ])

    const p2 = exportProtocol()
    expect(p2.tracks[0].children[0].startTime).toBe(500)
    expect(p2.tracks[0].children[0].endTime).toBe(2000)
  })

  it('should prevent overlap when resizing text segment', () => {
    const { addSegment, resizeSegment, exportProtocol, curTime } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    const text2: ITextSegment = {
      id: 'text-2',
      segmentType: 'text',
      startTime: 1000,
      endTime: 2000,
      texts: [{ content: 'Text 2' }],
    }

    addSegment(text1)
    curTime.value = 1000
    addSegment(text2)
    const p1 = exportProtocol()
    const track = p1.tracks[0]

    // Resize text-1 from 1000ms to 1500ms, causing overlap with text-2
    const resizeResult = resizeSegment({
      segmentId: 'text-1',
      trackId: track.trackId,
      startTime: 0,
      endTime: 1500,
    })
    expect(resizeResult.success).toBe(true)
    expect(resizeResult.affectedSegments.map(seg => ({
      id: seg.id,
      startTime: seg.startTime,
      endTime: seg.endTime,
    }))).toEqual([
      { id: 'text-1', startTime: 0, endTime: 1500 },
      { id: 'text-2', startTime: 1500, endTime: 2500 },
    ])

    const p2 = exportProtocol()
    expect(p2.tracks[0].children[0].startTime).toBe(0)
    expect(p2.tracks[0].children[0].endTime).toBe(1500)
    // text-2 should be pushed to 1500-2500 to avoid overlap
    expect(p2.tracks[0].children[1].startTime).toBe(1500)
    expect(p2.tracks[0].children[1].endTime).toBe(2500)
  })

  it('should allow gaps when moving text segment', () => {
    const { addSegment, moveSegment, exportProtocol, curTime } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    const text2: ITextSegment = {
      id: 'text-2',
      segmentType: 'text',
      startTime: 1000,
      endTime: 2000,
      texts: [{ content: 'Text 2' }],
    }

    addSegment(text1)
    curTime.value = 1000
    addSegment(text2)
    const p1 = exportProtocol()
    const track = p1.tracks[0]

    // Move text-1 to 3000-4000, leaving a gap (no overlap)
    moveSegment({
      segmentId: 'text-1',
      sourceTrackId: track.trackId,
      targetTrackId: track.trackId,
      startTime: 3000,
      endTime: 4000,
    })

    const p2 = exportProtocol()
    expect(p2.tracks[0].children).toHaveLength(2)
    // text-2 should remain at 1000-2000
    expect(p2.tracks[0].children[0].id).toBe('text-2')
    expect(p2.tracks[0].children[0].startTime).toBe(1000)
    expect(p2.tracks[0].children[0].endTime).toBe(2000)
    // text-1 should be at 3000-4000 (gap allowed)
    expect(p2.tracks[0].children[1].id).toBe('text-1')
    expect(p2.tracks[0].children[1].startTime).toBe(3000)
    expect(p2.tracks[0].children[1].endTime).toBe(4000)
  })

  it('should preserve time position when moving frames segment to new non-main track', () => {
    const { addSegment, moveSegment, exportProtocol, curTime } = createVideoProtocolManager(protocol)

    // Create main frames track with frame-1
    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    // Create another frames segment
    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    addSegment(frame1) // Creates main frames track at 0-1000
    curTime.value = 1000
    addSegment(frame2) // Adds to main track at 1000-2000

    const p1 = exportProtocol()
    const mainTrack = p1.tracks[0]

    // Move frame-2 to a new non-main frames track at time 3000
    moveSegment({
      segmentId: 'frame-2',
      sourceTrackId: mainTrack.trackId,
      startTime: 3000,
      endTime: 4000,
      isNewTrack: true,
      newTrackInsertIndex: 1,
    })

    const p2 = exportProtocol()
    expect(p2.tracks).toHaveLength(2)

    // Main track should only have frame-1, adjusted to 0-1000
    expect(p2.tracks[0].children).toHaveLength(1)
    expect(p2.tracks[0].children[0].id).toBe('frame-1')
    expect(p2.tracks[0].children[0].startTime).toBe(0)
    expect(p2.tracks[0].children[0].endTime).toBe(1000)

    // New non-main frames track should have frame-2 at the dragged position (3000-4000)
    expect(p2.tracks[1].children).toHaveLength(1)
    expect(p2.tracks[1].children[0].id).toBe('frame-2')
    expect(p2.tracks[1].children[0].startTime).toBe(3000) // Keep user's position
    expect(p2.tracks[1].children[0].endTime).toBe(4000)
    expect((p2.tracks[1] as any).isMain).toBeUndefined() // Not a main track
  })

  it('should support undo/redo for resizing text segment', () => {
    const { addSegment, resizeSegment, exportProtocol, undo, redo } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    addSegment(text1)
    const p1 = exportProtocol()
    const track = p1.tracks[0]

    expect(p1.tracks[0].children[0].startTime).toBe(0)
    expect(p1.tracks[0].children[0].endTime).toBe(1000)

    // Resize segment
    resizeSegment({
      segmentId: 'text-1',
      trackId: track.trackId,
      startTime: 500,
      endTime: 2000,
    })

    const p2 = exportProtocol()
    expect(p2.tracks[0].children[0].startTime).toBe(500)
    expect(p2.tracks[0].children[0].endTime).toBe(2000)

    // Undo should restore original size
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks[0].children[0].startTime).toBe(0)
    expect(p3.tracks[0].children[0].endTime).toBe(1000)

    // Redo should reapply the resize
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks[0].children[0].startTime).toBe(500)
    expect(p4.tracks[0].children[0].endTime).toBe(2000)
  })

  it('should support undo/redo for resizing frames segment', () => {
    const { addSegment, resizeSegment, exportProtocol, curTime, undo, redo } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    addSegment(frame1)
    curTime.value = 1000
    addSegment(frame2)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children[0].startTime).toBe(0)
    expect(p1.tracks[0].children[0].endTime).toBe(1000)
    expect(p1.tracks[0].children[1].startTime).toBe(1000)
    expect(p1.tracks[0].children[1].endTime).toBe(2000)

    const track = p1.tracks[0]

    // Resize frame-1, which should push frame-2
    resizeSegment({
      segmentId: 'frame-1',
      trackId: track.trackId,
      startTime: 0,
      endTime: 1500,
    })

    const p2 = exportProtocol()
    expect(p2.tracks[0].children[0].startTime).toBe(0)
    expect(p2.tracks[0].children[0].endTime).toBe(1500)
    expect(p2.tracks[0].children[1].startTime).toBe(1500) // Pushed
    expect(p2.tracks[0].children[1].endTime).toBe(2500)

    // Undo should restore original positions
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks[0].children[0].startTime).toBe(0)
    expect(p3.tracks[0].children[0].endTime).toBe(1000)
    expect(p3.tracks[0].children[1].startTime).toBe(1000)
    expect(p3.tracks[0].children[1].endTime).toBe(2000)

    // Redo should reapply the resize and push
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks[0].children[0].startTime).toBe(0)
    expect(p4.tracks[0].children[0].endTime).toBe(1500)
    expect(p4.tracks[0].children[1].startTime).toBe(1500)
    expect(p4.tracks[0].children[1].endTime).toBe(2500)
  })

  it('should resize frames segment and adjust subsequent segments', () => {
    const { addSegment, resizeSegment, exportProtocol, curTime } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    addSegment(frame1)
    curTime.value = 1000
    addSegment(frame2)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children[0].startTime).toBe(0)
    expect(p1.tracks[0].children[0].endTime).toBe(1000)
    expect(p1.tracks[0].children[1].startTime).toBe(1000)
    expect(p1.tracks[0].children[1].endTime).toBe(2000)

    const track = p1.tracks[0]

    // Resize frame-1 from 1000ms to 1500ms
    resizeSegment({
      segmentId: 'frame-1',
      trackId: track.trackId,
      startTime: 0,
      endTime: 1500,
    })

    const p2 = exportProtocol()
    expect(p2.tracks[0].children[0].startTime).toBe(0)
    expect(p2.tracks[0].children[0].endTime).toBe(1500)
    expect(p2.tracks[0].children[1].startTime).toBe(1500) // Adjusted +500
    expect(p2.tracks[0].children[1].endTime).toBe(2500) // Adjusted +500
  })

  it('should sync fromTime when resizing video segment start', () => {
    const { addSegment, resizeSegment, exportProtocol } = createVideoProtocolManager(protocol)

    const frame: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      fromTime: 1000,
      startTime: 0,
      endTime: 1000,
    }

    addSegment(frame)
    const track = exportProtocol().tracks[0]

    resizeSegment({
      segmentId: 'frame-1',
      trackId: track.trackId,
      startTime: 500,
      endTime: 1000,
    })

    const p2 = exportProtocol()
    const updated = p2.tracks[0].children[0] as IVideoFramesSegment
    expect(updated.startTime).toBe(0)
    expect(updated.endTime).toBe(500)
    expect(updated.fromTime).toBe(1500)
  })
})

describe('addSegment - undo/redo', () => {
  it('should support undo/redo for adding frames segment', () => {
    const { addSegment, exportProtocol, undo, redo } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    // Initial state - no tracks
    const p1 = exportProtocol()
    expect(p1.tracks.length).toBe(0)

    // Add segment - creates track
    addSegment(frame1)
    const p2 = exportProtocol()
    expect(p2.tracks.length).toBe(1)
    expect(p2.tracks[0].trackType).toBe('frames')
    expect(p2.tracks[0].children.length).toBe(1)
    expect(p2.tracks[0].children[0].id).toBe('frame-1')

    // Undo - should remove track
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks.length).toBe(0)

    // Redo - should restore track and segment
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks.length).toBe(1)
    expect(p4.tracks[0].children.length).toBe(1)
    expect(p4.tracks[0].children[0].id).toBe('frame-1')
  })

  it('should support undo/redo for adding text segment', () => {
    const { addSegment, exportProtocol, undo, redo } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 2000,
      texts: [{ content: 'Hello World' }],
    }

    // Add segment
    addSegment(text1)
    const p1 = exportProtocol()
    expect(p1.tracks.length).toBe(1)
    expect(p1.tracks[0].trackType).toBe('text')
    expect(p1.tracks[0].children[0].id).toBe('text-1')

    // Undo
    undo()
    const p2 = exportProtocol()
    expect(p2.tracks.length).toBe(0)

    // Redo
    redo()
    const p3 = exportProtocol()
    expect(p3.tracks.length).toBe(1)
    expect(p3.tracks[0].children[0].id).toBe('text-1')
  })

  it('should support undo/redo for adding multiple segments', () => {
    const { addSegment, exportProtocol, undo, redo, curTime } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    // Add first segment
    addSegment(frame1)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children.length).toBe(1)

    // Add second segment
    curTime.value = 1000
    addSegment(frame2)
    const p2 = exportProtocol()
    expect(p2.tracks[0].children.length).toBe(2)
    expect(p2.tracks[0].children[0].id).toBe('frame-1')
    expect(p2.tracks[0].children[1].id).toBe('frame-2')

    // Undo once - should remove second segment
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks[0].children.length).toBe(1)
    expect(p3.tracks[0].children[0].id).toBe('frame-1')

    // Undo again - should remove first segment and track
    undo()
    const p4 = exportProtocol()
    expect(p4.tracks.length).toBe(0)

    // Redo once - should restore first segment
    redo()
    const p5 = exportProtocol()
    expect(p5.tracks.length).toBe(1)
    expect(p5.tracks[0].children.length).toBe(1)
    expect(p5.tracks[0].children[0].id).toBe('frame-1')

    // Redo again - should restore second segment
    redo()
    const p6 = exportProtocol()
    expect(p6.tracks[0].children.length).toBe(2)
    expect(p6.tracks[0].children[0].id).toBe('frame-1')
    expect(p6.tracks[0].children[1].id).toBe('frame-2')
  })
})

describe('removeSegment - undo/redo', () => {
  it('should support undo/redo for removing segment', () => {
    const { addSegment, removeSegment, exportProtocol, undo, redo } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    // Add segment
    addSegment(frame1)
    const p1 = exportProtocol()
    expect(p1.tracks.length).toBe(1)
    expect(p1.tracks[0].children.length).toBe(1)

    // Remove segment
    expect(removeSegment('frame-1').success).toBe(true)
    const p2 = exportProtocol()
    expect(p2.tracks.length).toBe(1)
    expect(p2.tracks[0].children.length).toBe(0)

    // Undo - should restore segment and track
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks.length).toBe(1)
    expect(p3.tracks[0].children.length).toBe(1)
    expect(p3.tracks[0].children[0].id).toBe('frame-1')

    // Redo - should remove segment and track again
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks.length).toBe(1)
    expect(p4.tracks[0].children.length).toBe(0)
  })

  it('should support undo/redo for removing one of multiple segments', () => {
    const { addSegment, removeSegment, exportProtocol, undo, redo, curTime } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 1000,
      texts: [{ content: 'Text 1' }],
    }

    const text2: ITextSegment = {
      id: 'text-2',
      segmentType: 'text',
      startTime: 1000,
      endTime: 2000,
      texts: [{ content: 'Text 2' }],
    }

    // Add two segments
    addSegment(text1)
    curTime.value = 1000
    addSegment(text2)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children.length).toBe(2)

    // Remove first segment
    expect(removeSegment('text-1').success).toBe(true)
    const p2 = exportProtocol()
    expect(p2.tracks.length).toBe(1) // Track still exists
    expect(p2.tracks[0].children.length).toBe(1)
    expect(p2.tracks[0].children[0].id).toBe('text-2')

    // Undo - should restore first segment
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks[0].children.length).toBe(2)
    expect(p3.tracks[0].children[0].id).toBe('text-1')
    expect(p3.tracks[0].children[1].id).toBe('text-2')

    // Redo - should remove first segment again
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks[0].children.length).toBe(1)
    expect(p4.tracks[0].children[0].id).toBe('text-2')
  })
})

describe('updateSegment - undo/redo', () => {
  it('should support undo/redo for updating segment properties', () => {
    const { addSegment, updateSegment, exportProtocol, undo, redo } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
      opacity: 1,
    }

    // Add segment
    addSegment(frame1)
    const p1 = exportProtocol()
    expect((p1.tracks[0].children[0] as IVideoFramesSegment).opacity).toBe(1)
    expect((p1.tracks[0].children[0] as IVideoFramesSegment).url).toBe('file:///video1.mp4')

    // Update segment
    updateSegment((segment) => {
      segment.opacity = 0.5
      segment.url = 'file:///video2.mp4'
    }, 'frame-1', 'frames')

    const p2 = exportProtocol()
    expect((p2.tracks[0].children[0] as IVideoFramesSegment).opacity).toBe(0.5)
    expect((p2.tracks[0].children[0] as IVideoFramesSegment).url).toBe('file:///video2.mp4')

    // Undo - should restore original values
    undo()
    const p3 = exportProtocol()
    expect((p3.tracks[0].children[0] as IVideoFramesSegment).opacity).toBe(1)
    expect((p3.tracks[0].children[0] as IVideoFramesSegment).url).toBe('file:///video1.mp4')

    // Redo - should apply changes again
    redo()
    const p4 = exportProtocol()
    expect((p4.tracks[0].children[0] as IVideoFramesSegment).opacity).toBe(0.5)
    expect((p4.tracks[0].children[0] as IVideoFramesSegment).url).toBe('file:///video2.mp4')
  })

  it('should support undo/redo for updating text segment content', () => {
    const { addSegment, updateSegment, exportProtocol, undo, redo } = createVideoProtocolManager(protocol)

    const text1: ITextSegment = {
      id: 'text-1',
      segmentType: 'text',
      startTime: 0,
      endTime: 2000,
      texts: [{ content: 'Original Text' }],
    }

    // Add segment
    addSegment(text1)
    const p1 = exportProtocol()
    expect((p1.tracks[0].children[0] as ITextSegment).texts[0].content).toBe('Original Text')

    // Update text content
    updateSegment((segment) => {
      segment.texts[0].content = 'Updated Text'
    }, 'text-1', 'text')

    const p2 = exportProtocol()
    expect((p2.tracks[0].children[0] as ITextSegment).texts[0].content).toBe('Updated Text')

    // Undo
    undo()
    const p3 = exportProtocol()
    expect((p3.tracks[0].children[0] as ITextSegment).texts[0].content).toBe('Original Text')

    // Redo
    redo()
    const p4 = exportProtocol()
    expect((p4.tracks[0].children[0] as ITextSegment).texts[0].content).toBe('Updated Text')
  })
})

describe('addTransition - undo/redo', () => {
  it('should support undo/redo for adding transition', () => {
    const { addSegment, addTransition, getSegment, undo, redo, curTime } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    // Add two segments to create main frames track
    addSegment(frame1)
    curTime.value = 1000
    addSegment(frame2)
    // Verify transition fields are undefined before adding
    expect(getSegment('frame-1', 'frames')?.transitionIn).toBeUndefined()
    expect(getSegment('frame-2', 'frames')?.transitionOut).toBeUndefined()

    // Add transition between frame-1 and frame-2 at time 1000
    const transition: ITransition = {
      id: 'transition-1',
      name: 'fade',
      duration: 300,
    }
    const added = addTransition(transition, 1000)
    expect(added).toBe(true)

    // Verify transition was added (frame-1 gets transitionIn, frame-2 gets transitionOut)
    expect(getSegment('frame-1', 'frames')?.transitionIn).toEqual(transition)
    expect(getSegment('frame-2', 'frames')?.transitionOut).toEqual(transition)

    // Undo - should remove transition (single operation)
    undo()
    expect(getSegment('frame-1', 'frames')?.transitionIn).toBeUndefined()
    expect(getSegment('frame-2', 'frames')?.transitionOut).toBeUndefined()

    // Redo - should restore transition
    redo()
    expect(getSegment('frame-1', 'frames')?.transitionIn).toEqual(transition)
    expect(getSegment('frame-2', 'frames')?.transitionOut).toEqual(transition)
  })
})

describe('removeTransition - undo/redo', () => {
  it('should support undo/redo for removing transition', () => {
    const { addSegment, addTransition, removeTransition, getSegment, undo, redo, curTime } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    // Add two segments and a transition
    addSegment(frame1)
    curTime.value = 1000
    addSegment(frame2)
    const transition: ITransition = {
      id: 'transition-1',
      name: 'fade',
      duration: 300,
    }
    addTransition(transition, 1000)

    // Verify transition was added
    expect(getSegment('frame-1', 'frames')?.transitionIn).toEqual(transition)
    expect(getSegment('frame-2', 'frames')?.transitionOut).toEqual(transition)

    // Remove transition from frame-2
    const removed = removeTransition('frame-2')
    expect(removed).toBe(true)
    expect(getSegment('frame-1', 'frames')?.transitionIn).toBeUndefined()
    expect(getSegment('frame-2', 'frames')?.transitionOut).toBeUndefined()

    // Undo - should restore transition (single operation)
    undo()
    expect(getSegment('frame-1', 'frames')?.transitionIn).toEqual(transition)
    expect(getSegment('frame-2', 'frames')?.transitionOut).toEqual(transition)

    // Redo - should remove transition again
    redo()
    expect(getSegment('frame-1', 'frames')?.transitionIn).toBeUndefined()
    expect(getSegment('frame-2', 'frames')?.transitionOut).toBeUndefined()
  })
})

describe('complex undo/redo scenarios', () => {
  it('should support undo/redo for mixed operations', () => {
    const { addSegment, updateSegment, exportProtocol, undo, redo, curTime } = createVideoProtocolManager(protocol)

    // Operation 1: Add frame-1
    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
      opacity: 1,
    }
    addSegment(frame1)
    // Operation 2: Add frame-2
    curTime.value = 1000
    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
      opacity: 1,
    }
    addSegment(frame2)
    // Operation 3: Update frame-1 opacity
    updateSegment((segment) => {
      segment.opacity = 0.5
    }, 'frame-1', 'frames')

    const p1 = exportProtocol()
    expect(p1.tracks[0].children.length).toBe(2)
    expect((p1.tracks[0].children[0] as IVideoFramesSegment).opacity).toBe(0.5)

    // Undo operation 3 - opacity update
    undo()
    const p2 = exportProtocol()
    expect((p2.tracks[0].children[0] as IVideoFramesSegment).opacity).toBe(1)

    // Undo operation 2 - add frame-2
    undo()
    const p3 = exportProtocol()
    expect(p3.tracks[0].children.length).toBe(1)
    expect(p3.tracks[0].children[0].id).toBe('frame-1')

    // Undo operation 1 - add frame-1
    undo()
    const p4 = exportProtocol()
    expect(p4.tracks.length).toBe(0)

    // Redo operation 1 - restore frame-1
    redo()
    const p5 = exportProtocol()
    expect(p5.tracks.length).toBe(1)
    expect(p5.tracks[0].children.length).toBe(1)
    expect(p5.tracks[0].children[0].id).toBe('frame-1')

    // Redo operation 2 - restore frame-2
    redo()
    const p6 = exportProtocol()
    expect(p6.tracks[0].children.length).toBe(2)

    // Redo operation 3 - restore opacity update
    redo()
    const p7 = exportProtocol()
    expect((p7.tracks[0].children[0] as IVideoFramesSegment).opacity).toBe(0.5)
  })

  it('should clear redo history when new operation is performed after undo', () => {
    const { addSegment, exportProtocol, undo, redo, redoCount, curTime } = createVideoProtocolManager(protocol)

    const frame1: IVideoFramesSegment = {
      id: 'frame-1',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video1.mp4',
      startTime: 0,
      endTime: 1000,
    }

    const frame2: IVideoFramesSegment = {
      id: 'frame-2',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video2.mp4',
      startTime: 0,
      endTime: 1000,
    }

    // Add frame-1
    addSegment(frame1)
    curTime.value = 1000
    // Add frame-2
    addSegment(frame2)
    const p1 = exportProtocol()
    expect(p1.tracks[0].children.length).toBe(2)

    // Undo add frame-2
    undo()
    const p2 = exportProtocol()
    expect(p2.tracks[0].children.length).toBe(1)
    expect(redoCount.value).toBe(1)

    // Add frame-3 (different segment) - should clear redo history
    const frame3: IVideoFramesSegment = {
      id: 'frame-3',
      segmentType: 'frames',
      type: 'video',
      url: 'file:///video3.mp4',
      startTime: 0,
      endTime: 1000,
    }
    addSegment(frame3)
    expect(redoCount.value).toBe(0) // Redo history cleared

    const p3 = exportProtocol()
    expect(p3.tracks[0].children.length).toBe(2)
    expect(p3.tracks[0].children[1].id).toBe('frame-3') // Not frame-2

    // Redo should not restore frame-2
    redo()
    const p4 = exportProtocol()
    expect(p4.tracks[0].children.length).toBe(2)
    expect(p4.tracks[0].children[1].id).toBe('frame-3')
  })
})
