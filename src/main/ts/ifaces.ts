export type TFlags = Record<string, any>

export type TContext = {
  ctx: TContext
  cwd: string
  temp: string
  flags: TFlags
  manifest: Record<string, any>
  err?: any
  report?: TAuditReport
}

export type TCallback = (cxt: TContext) => void | Promise<void>

export type TStage = [string, ...TCallback[]]

export type ICallable<A extends any[] = any[], R = any> = (...args: A) => R

export type TFlow = {
  main: TStage[]
  fallback: TStage[]
}

export type TAuditEntry = {
  data: {
    advisory: {
      module_name: string
      vulnerable_versions: string
      patched_versions: string
    }
  }
}

export type TAuditReport = {
  [versionInfo: string]: {
    module_name: string
    vulnerable_versions: string
    patched_versions: string
  }
}

export type TLockfileObject = {
  [versionInfo: string]: {
    version: string
    resolved: string
    integrity: string
    dependencies: string[]
  };
};
