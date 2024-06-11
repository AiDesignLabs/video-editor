import type { IVideoProtocol, TrackTypeMapTrack } from '@video-editor/shared'

export type IMappingVideoProtocol = Omit<IVideoProtocol, 'tracks'> &
  {
    tracks: {
      [K in keyof TrackTypeMapTrack]: TrackTypeMapTrack[K][];
    }
  }

export type AppendArgument<Func, Arg> = Func extends (...args: infer Args) => infer ReturnType
  ? (...args: [...Args, Arg?]) => ReturnType
  : never
