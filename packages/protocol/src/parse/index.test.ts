import type { IVideoProtocol } from '@video-editor/shared'
import { parse } from './index'

it('parse valid protocol', () => {
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

it('parse invalid protocol with empty string', () => {
  const fn = () => parse('')
  expect(fn).toThrowError('invalid protocol')
})

it('parse invalid protocol with not string', () => {
  // @ts-expect-error test invalid input
  expect(() => parse(null)).toThrowError('invalid protocol')
  // @ts-expect-error test invalid input
  expect(() => parse(undefined)).toThrowError('invalid protocol')
  // @ts-expect-error test invalid input
  expect(() => parse(1)).toThrowError('invalid protocol')
  // @ts-expect-error test invalid input
  expect(() => parse()).toThrowError('invalid protocol')
  // @ts-expect-error test invalid input
  expect(() => parse({})).toThrowError('invalid protocol')
})

it('parse invalid protocol with invalid Object string', () => {
  expect(() => parse('a')).toThrowError('invalid protocol')
  expect(() => parse('1')).toThrowError('invalid protocol')
  expect(() => parse('[1]')).toThrowError('invalid protocol')
  expect(() => parse('null')).toThrowError('invalid protocol')
  expect(() => parse('undefined')).toThrowError('invalid protocol')
  expect(() => parse('() => 1')).toThrowError('invalid protocol')
})
