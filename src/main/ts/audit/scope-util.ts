import path from 'node:path'

import type { Graph } from 'lockgraph'
import sv from 'semver'

export type NodeId = Parameters<Graph['getNode']>[0]
export type GNode = NonNullable<ReturnType<Graph['getNode']>>

/** Root + workspace manifests, as collected by `collectManifestFiles`. */
export type TManifestFile = { file: string; manifest: Record<string, any> }

// Production = everything a `--omit=dev` install materializes: dependencies,
// optionalDependencies, peerDependencies. Only a *dev-only* direct dep is dropped
// (a name in dependencies AND devDependencies is production). yarn.lock carries no
// dev/prod signal — every edge is `dep` — so this classification lives in the
// package.json fields, never in the graph.
export const PROD_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]
export const ALL_FIELDS = [...PROD_FIELDS, 'devDependencies']

/** `YAF_PRODUCTION=false` must not read truthy (env values arrive as strings). */
export const truthy = (v: unknown): boolean =>
  v === true ||
  (typeof v === 'string' && v !== '' && v !== 'false' && v !== '0')

export const namesIn = (
  manifest: Record<string, any> | undefined,
  fields: readonly string[],
): Set<string> => {
  const out = new Set<string>()
  for (const f of fields) {
    const deps = manifest?.[f]
    if (deps && typeof deps === 'object')
      for (const name of Object.keys(deps)) out.add(name)
  }
  return out
}

/** Strip yarn's `npm:` alias; return a usable semver range or undefined. */
export const normalizeRange = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const r = raw.startsWith('npm:') ? raw.slice(4) : raw
  return sv.validRange(r) ? r : undefined
}

/** A workspace node's path or a manifest dir, normalized to `/`-joined, no trailing slash. */
export const norm = (p: string): string =>
  p.split(path.sep).join('/').replace(/\/+$/, '')

/** Workspace dir of a manifest file, relative to cwd (`''` = root). */
export const dirOf = (cwd: string | undefined, file: string): string =>
  norm(cwd ? path.relative(cwd, path.dirname(file)) : path.dirname(file))
