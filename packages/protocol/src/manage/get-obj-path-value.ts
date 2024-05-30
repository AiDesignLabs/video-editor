type Path = string | number | symbol
export type Paths = Path[]
type Obj = Record<Path, any>
type Deep = 10

type ConcatPath<PathArr extends Paths, P extends Path> = [...PathArr, P]

type GetArrayNamePaths<Arr extends Array<unknown>, MaxDeep extends number = Deep, PathArr extends Paths = [], CountArr extends unknown[] = []> =
  PathArr['length'] extends MaxDeep ?
    PathArr :
    Arr extends [] ? never :
      Arr extends [infer First, ...infer Rest] ?
        First extends Obj ?
  ConcatPath<PathArr, CountArr['length']> | GetObjNamePaths<First, MaxDeep, ConcatPath<PathArr, CountArr['length']>> | GetArrayNamePaths<Rest, MaxDeep, PathArr, [...CountArr, First]> :
  ConcatPath<PathArr, CountArr['length']> | GetArrayNamePaths<Rest, MaxDeep, PathArr, [...CountArr, First]> :
        Arr extends unknown[] ?
          Arr[0] extends Obj ?
  ConcatPath<PathArr, number> | GetObjNamePaths<Arr[0], MaxDeep, ConcatPath<PathArr, number>> :
            ConcatPath<PathArr, number> :
          never

// TODO: @wendraw use is-type optimize code
export type GetObjNamePaths<O extends Obj | Obj[], MaxDeep extends number = Deep, PathArr extends Paths = [], P extends keyof O = keyof O> =
  PathArr['length'] extends MaxDeep ?
    PathArr :
    O extends unknown[] ?
      GetArrayNamePaths<O, MaxDeep, PathArr> :
      P extends Path ?
        O[P] extends unknown[] ?
  ConcatPath<PathArr, P> | GetArrayNamePaths<O[P], MaxDeep, ConcatPath<PathArr, P>> :
          O[P] extends Obj ?
  ConcatPath<PathArr, P> | GetObjNamePaths<O[P], MaxDeep, ConcatPath<PathArr, P>, keyof O[P]> :
            ConcatPath<PathArr, P> :
        never

export type GetObjValue<O extends Obj, P extends Paths> =
  P extends [infer First, ...infer Rest extends Paths] ?
    First extends keyof O ?
      Rest extends [] ?
        O[First] :
        GetObjValue<O[First], Rest> :
      never :
    never
