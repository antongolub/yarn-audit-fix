export type TFlags = Record<string, any>

export type TFlagsMapping = {
  [flag: string]:
    | string
    | { key?: string; value?: string; values?: { [val: string]: string } }
}

export type TContext = {
  ctx: TContext
  cwd: string
  temp: string
  flags: TFlags
  manifest: Record<string, any>
  versions: Record<string, string>
  bins: Record<string, string>
  err?: any
}

export type TNote = string

export type TCallback = (cxt: TContext) => void | Promise<void>

export type TStage = Array<TCallback | TNote | TStage>

export type ICallable<A extends any[] = any[], R = any> = (...args: A) => R

export type TFlow = {
  main: TStage
  fallback: TStage
}

export type TAuditAdvisory = {
  module_name: string // eslint-disable-line camelcase
  vulnerable_versions: string // eslint-disable-line camelcase
  patched_versions: string // eslint-disable-line camelcase
}

export type TAuditEntry = {
  data: {
    advisory: TAuditAdvisory
  }
}

export type TAuditReport = {
  [versionInfo: string]: TAuditAdvisory
}

export type TLockfileEntry = {
  version: string
  resolved: string
  integrity: string
  dependencies?: Record<string, string>

  // v2
  resolution: string
  [rest: string]: any
}

export type TLockfileObject = {
  [versionInfo: string]: TLockfileEntry
}

export type TLockfileType = 'yarn1' | 'yarn2' | undefined
