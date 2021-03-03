export type TContext = {
  cwd: string
  temp: string
  flags: Record<string, any>
  manifest: Record<string, any>
}

export type TCallback = (cxt: TContext) => void | Promise<void>

export type TStage = [string, ...TCallback[]]
