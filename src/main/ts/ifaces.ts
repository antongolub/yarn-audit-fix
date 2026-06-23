export type TFlags = Record<string, any>

export type TFlagsMapping = {
  [flag: string]:
    | string
    | { key?: string; value?: string; values?: { [val: string]: string } }
}

export type TContext = {
  ctx: TContext
  cwd: string
  flags: TFlags
  manifest: Record<string, any>
  versions: Record<string, string>
  err?: any
  // Optional `@antongolub/lockfile` RegistryAdapter override — tests inject a
  // mock here; production builds a live, scope-aware one via `buildRegistry`.
  registry?: any
  // Optional `refurbish` TarballSource override — tests inject canned tarball
  // bytes here; production builds a live one via `buildTarballSource`.
  tarballSource?: any
  // Optional progress reporter (spinner) for the network-bound patch phases;
  // set by `patchLockfile`. Absent in direct/test calls. See `ui.createProgress`.
  progress?: any
  // Optional AbortSignal — set by `run` so Ctrl+C/SIGTERM cancel in-flight
  // registry HTTP cooperatively (advisory POST, tarball GET). Absent in
  // direct/test calls.
  signal?: any
}

export type TCallback = (cxt: TContext) => void | Promise<void>

export type ICallable<A extends any[] = any[], R = any> = (...args: A) => R

// Normalized advisory used across the patch pipeline. Metadata fields are
// optional — yarn 4's NDJSON carries no CVE/CVSS, only severity + a GHSA url.
export type TAuditAdvisory = {
  module_name: string // eslint-disable-line camelcase
  vulnerable_versions: string // eslint-disable-line camelcase
  patched_versions: string // eslint-disable-line camelcase
  severity?: string
  cvss?: number
  refs?: string[] // CVE / GHSA identifiers
  url?: string
}

// Raw npm/yarn advisory as emitted by `(yarn|npm) audit --json` (v1/v2).
export type TRawAdvisory = {
  module_name: string // eslint-disable-line camelcase
  vulnerable_versions: string // eslint-disable-line camelcase
  patched_versions: string // eslint-disable-line camelcase
  severity?: string
  cves?: string[]
  cvss?: { score?: number } | null
  url?: string
  references?: string
  title?: string
}

export type TAuditEntry = {
  data: {
    advisory: TRawAdvisory
  }
}

export type TAuditReport = {
  [versionInfo: string]: TAuditAdvisory
}

import type { FormatId, Graph } from '@antongolub/lockfile'

export type TLockfileEntry = {
  version: string
  resolved: string
  integrity: string
  dependencies?: Record<string, string>

  // v2
  resolution: string
  [rest: string]: any
}

// Graph from @antongolub/lockfile; all operations go through ./lockfile.
export type TLockfileObject = Graph

// FormatId from @antongolub/lockfile (e.g. 'yarn-classic', 'yarn-berry-v8').
// `undefined` retained for the "format not recognised" sentinel.
export type TLockfileType = FormatId | undefined
