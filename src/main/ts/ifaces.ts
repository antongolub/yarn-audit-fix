export type TFlags = Record<string, any>

export type TContext = {
  cwd: string
  temp: string
  flags: TFlags
  manifest: Record<string, any>
}

export type TCallback = (cxt: TContext) => void | Promise<void>

export type TStage = [string, ...TCallback[]]
