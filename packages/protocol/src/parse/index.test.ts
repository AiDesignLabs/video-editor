import type { IVideoProtocol } from '@video-editor/shared'
import { parse } from './index'

test('parse valid protocol', () => {
  const videoProtocol: IVideoProtocol = {
    version: '0.0.1',
    width: 500,
    height: 500,
    fps: 25,
    tracks: [],
  }
  const o = parse(JSON.stringify(videoProtocol))
  expect(o).toEqual(videoProtocol)
})

test('parse invalid protocol with empty string', () => {
  const fn = () => parse('')
  expect(fn).toThrowError('invalid protocol')
})

test('parse invalid protocol with not string', () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  expect(() => parse(null)).toThrowError('invalid protocol')
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  expect(() => parse(undefined)).toThrowError('invalid protocol')
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  expect(() => parse(1)).toThrowError('invalid protocol')
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  expect(() => parse()).toThrowError('invalid protocol')
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  expect(() => parse({})).toThrowError('invalid protocol')
})

test('parse invalid protocol with invalid Object string', () => {
  expect(() => parse('a')).toThrowError('invalid protocol')
  expect(() => parse('1')).toThrowError('invalid protocol')
  expect(() => parse('[1]')).toThrowError('invalid protocol')
  expect(() => parse('null')).toThrowError('invalid protocol')
  expect(() => parse('undefined')).toThrowError('invalid protocol')
  expect(() => parse('() => 1')).toThrowError('invalid protocol')
})
