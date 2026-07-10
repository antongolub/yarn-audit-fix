export type TFlags = Record<string, any>

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
  // Optional `fetch` override — tests inject a stub so the registry audit stays
  // offline; production wires the AbortSignal through the global fetch.
  fetch?: any
  // Direct-dep range rewrites for package.json, recorded by `_patch` under --force
  // when a declared range can't admit the fix (`npm audit fix --force` parity);
  // applied to the manifest by `patchLockfile`. Absent = no manifest change.
  manifestEdits?: TManifestEdit[]
}

// A package.json direct-dep range rewrite: `"<name>": "<from>"` → `"<name>": "<to>"`.
export type TManifestEdit = { name: string; from: string; to: string }

export type TCallback = (cxt: TContext) => void | Promise<void>

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

export type TAuditReport = {
  [versionInfo: string]: TAuditAdvisory
}

import type { FormatId, Graph } from '@antongolub/lockfile'

// Graph from @antongolub/lockfile; all operations go through ./lockfile.
export type TLockfileObject = Graph

// FormatId from @antongolub/lockfile (e.g. 'yarn-classic', 'yarn-berry-v8').
// `undefined` retained for the "format not recognised" sentinel.
export type TLockfileType = FormatId | undefined
