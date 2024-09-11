export type AppendArgument<Func, Arg> = Func extends (...args: infer Args) => infer ReturnType
  ? (...args: [...Args, Arg?]) => ReturnType
  : never
