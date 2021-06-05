export type TFlags = Record<string, any>

export type TContext = {
  cwd: string
  temp: string
  flags: TFlags
  manifest: Record<string, any>
  err?: any
}

export type TCallback = (cxt: TContext) => void | Promise<void>

export type TStage = [string, ...TCallback[]]

export type ICallable<A extends any[] = any[], R = any> = (...args: A) => R

export type TFlow = {
  main: TStage[]
  fallback: TStage[]
}
