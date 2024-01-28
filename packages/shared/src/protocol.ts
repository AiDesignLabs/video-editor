/**
 * NOTE: that without special explanation:
 * * the time related value is in ms
 * * the numerical value is normalized in range [0, 1] unless otherwise specified
 */

export interface IVideoProtocol {
  version: `${number}.${number}.${number}`
  width: number
  height: number
  fps: number
  tracks: TrackUnion[]
}

export type ITrack<T extends ITrackType> = {
  trackId: string
  trackType: T
  children: TrackTypeMapSegment[T][]
} & (T extends 'frames' ? {
  isMain?: boolean
} : {})

export type ITrackType = keyof TrackTypeMapSegment

export interface TrackTypeMapSegment {
  frames: IFramesSegmentUnion
  text: ITextSegment
  image: IImageSegment
  audio: IAudioSegment
  effect: IEffectSegment
  filter: IFilterSegment
}

export type TrackTypeMapTrack = {
  [Key in ITrackType]: ITrack<Key>;
}

type TrackUnion = TrackTypeMapTrack[ITrackType]

export interface IFramesSegment extends ISegment {
  type: 'image' | 'video' | '3D'
  url: string
  transform?: ITransform
  opacity?: number // 0-1
  fillMode?: IFillMode
  animation?: IAnimation
  transitionIn?: ITransition
  transitionOut?: ITransition
  palette?: IPalette
  background?: `rgba(${number},${number},${number},${number})`
}

interface IVideoFramesSegment extends IFramesSegment {
  type: 'video'
  fromTime?: number // from time in video where to start, default 0
  volume?: number // volume of the video, value between [0, 1], default 1
  playRate?: number // play rate of the video, value between [0.1, 100], default 1
}

interface IImageFramesSegment extends IFramesSegment {
  type: 'image'
  format: 'img' | 'gif'
}

interface I3DFramesSegment extends IFramesSegment {
  type: '3D'
}

export type IFramesSegmentUnion = IVideoFramesSegment | IImageFramesSegment | I3DFramesSegment

export interface ITextSegment extends ISegment {
  texts: ITextBasic[]
  transform?: ITransform
  opacity?: number // 0-1
  animation?: IAnimation
}

export interface IImageSegment extends ISegment {
  format: 'img' | 'gif'
  url: string
  fillMode?: IFillMode
  animation?: IAnimation
  transform?: ITransform
  palette?: IPalette
}

export interface IAudioSegment extends ISegment {
  url: string
  fromTime?: number // from time in audio where to start, default 0
  volume?: number // volume of the audio, value between [0, 1], default 1
  fadeInDuration?: number // in ms, range [0, (endTime - startTime) / 2]
  fadeOutDuration?: number // in ms, range [0, (endTime - startTime) / 2]
  playRate?: number // play rate of the audio, value between [0.1, 100], default 1
}

export interface IEffectSegment extends ISegment {
  effectId: string
  name: string
}

export interface IFilterSegment extends ISegment {
  filterId: string
  name: string
  intensity?: number // 0-1
}

export interface ISegment {
  id: string
  startTime: number
  endTime: number
  url?: string
}

export interface ITransform {
  position: [number, number, number] // [x, y, z] value between [-1, 1], origin is the center of the canvas
  rotation: [number, number, number] // [x, y, z] value between [0, 360]
  scale: [number, number, number] // [x, y, z]
}

export type IFillMode = 'none' | 'contain' | 'cover' | 'stretch'

export interface IAnimation {
  id: string
  name: string
  duration: number // in ms
  type: 'in' | 'out' | 'combo'
  url?: string
}

export interface ITransition {
  id: string
  name: string
  duration: number // in ms
}

export interface IPalette {
  // colors
  temperature: number // 色温 [1000, 40000]，默认 6500
  hue: number // 色调 [-1, 1]，默认 0
  saturation: number // 饱和度 [-1, 1]，默认 0

  // lightness
  brightness: number // 亮度 [-1, 1]，默认 0
  contrast: number // 对比度 [-1, 1]，默认 0
  shine: number // 光泽度 [-1, 1]，默认 0
  highlight: number // 高光 [-1, 1]，默认 0
  shadow: number // 阴影 [-1, 1]，默认 0

  // effects
  sharpness: number // 锐度 [-1, 1]，默认 0
  vignette: number // 暗角 [0, 1]，默认 0
  fade: number // 褪色 [0, 1]，默认 0
  grain: number // 颗粒 [0, 1]，默认 0
}

export interface ITextBasic {
  content: string
  align?: 'left' | 'center' | 'right' | 'justify'
  dropShadow?: IDropShadow
  fontFamily?: string | string[]
  fontSize?: number
  fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
  fontStyle?: 'normal' | 'italic' | 'oblique'
  underline?: boolean
  fill?: string
  letterSpacing?: number
  leading?: number
  stroke?: IStroke
  background?: IBackground
}

export interface IDropShadow {
  color?: string
  opacity?: number // 0-1
  blur?: number // 0-100
  distance?: number
  angle?: number
}

export interface IBackground {
  color?: string
  opacity?: number // 0-1
}

export interface IStroke {
  color?: string
  width?: number
  opacity?: number // 0-1
}
