import path from 'node:path'

import type { Graph } from 'lockgraph'
import sv from 'semver'

import { globToRegExp, split } from './filter'

type NodeId = Parameters<Graph['getNode']>[0]
type GNode = NonNullable<ReturnType<Graph['getNode']>>

/** Root + workspace manifests, as collected by `collectManifestFiles`. */
export type TManifestFile = { file: string; manifest: Record<string, any> }

// Production = everything a `--omit=dev` install materializes: dependencies,
// optionalDependencies, peerDependencies. Only a *dev-only* direct dep is dropped
// (a name in dependencies AND devDependencies is production). yarn.lock carries no
// dev/prod signal — every edge is `dep` — so this classification lives in the
// package.json fields, never in the graph.
const PROD_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']
const ALL_FIELDS = [...PROD_FIELDS, 'devDependencies']

/** `YAF_PRODUCTION=false` must not read truthy (env values arrive as strings). */
const truthy = (v: unknown): boolean =>
  v === true || (typeof v === 'string' && v !== '' && v !== 'false' && v !== '0')

const namesIn = (
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
const normalizeRange = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const r = raw.startsWith('npm:') ? raw.slice(4) : raw
  return sv.validRange(r) ? r : undefined
}

/** A workspace node's path or a manifest dir, normalized to `/`-joined, no trailing slash. */
const norm = (p: string): string => p.split(path.sep).join('/').replace(/\/+$/, '')

/** Workspace dir of a manifest file, relative to cwd (`''` = root). */
const dirOf = (cwd: string | undefined, file: string): string =>
  norm(cwd ? path.relative(cwd, path.dirname(file)) : path.dirname(file))

/** A short human summary of the active scope, for the report header. */
export const describeScope = (flags: Record<string, any>): string =>
  [
    truthy(flags.production) ? 'production' : undefined,
    split(flags.workspace).length
      ? `workspaces [${split(flags.workspace).join(', ')}]`
      : undefined,
  ]
    .filter(Boolean)
    .join(' + ')

/**
 * Resolve the fix scope from `--production` / `--workspace`. Returns the set of
 * in-scope node ids — a vulnerable node is remediated only if it's reachable from
 * the scoped roots — or `undefined` when neither flag is set (no filtering; the
 * output stays byte-identical to today).
 *
 * Roots are the selected workspaces' direct dependencies: all workspace + root
 * manifests, or only those matched by `--workspace` (glob on name / path / path
 * basename); minus dev-only deps under `--production`. The walk then follows every
 * edge out of a regular package, but at a workspace reached *as a dependency* only
 * its production edges — so one workspace's dev tree never leaks into another's
 * production closure. Precise per-workspace resolution uses the workspace node's
 * own out-edges; where the lockfile has no workspace node (yarn classic v1) it
 * falls back to resolving each declared dep by name + range.
 *
 * Throws when `--workspace` matches no workspace (a typo shouldn't silently fix
 * nothing).
 */
export const resolveScope = (
  flags: Record<string, any>,
  graph: Graph,
  manifestFiles: TManifestFile[],
  cwd?: string,
): Set<NodeId> | undefined => {
  const production = truthy(flags.production)
  const patterns = split(flags.workspace)
  if (!production && patterns.length === 0) return undefined

  // manifest per workspace dir; graph workspace node per its workspacePath.
  const manifestByDir = new Map<string, Record<string, any>>()
  for (const { file, manifest } of manifestFiles)
    manifestByDir.set(dirOf(cwd, file), manifest)
  const wsNodeByDir = new Map<string, GNode>()
  for (const n of graph.nodes())
    if (n.workspacePath !== undefined) wsNodeByDir.set(norm(n.workspacePath), n)

  // Which workspace dirs are in scope: `--workspace` globs match a workspace's
  // manifest name, its dir, or the dir's basename; absent → every manifest.
  let selected: string[]
  if (patterns.length > 0) {
    const globs = patterns.map(globToRegExp)
    selected = [...manifestByDir].filter(([dir, manifest]) => {
      const ids = [manifest?.name, dir, dir.split('/').pop()].filter(
        (x): x is string => typeof x === 'string' && x !== '',
      )
      return ids.some((id) => globs.some((g) => g.test(id)))
    }).map(([dir]) => dir)
    if (selected.length === 0)
      throw new Error(`--workspace matched no workspaces: ${patterns.join(', ')}`)
  } else {
    selected = [...manifestByDir.keys()]
  }

  // Production-dep names per workspace dir — the walk consults these when it reaches
  // a workspace as a dependency (expand its prod edges only).
  const prodNamesByDir = new Map<string, Set<string>>()
  for (const [dir, manifest] of manifestByDir)
    prodNamesByDir.set(dir, namesIn(manifest, PROD_FIELDS))

  // Seed: each selected workspace's direct deps → their resolved nodes.
  const seeds = new Set<NodeId>()
  for (const dir of selected) {
    const manifest = manifestByDir.get(dir)
    const seedNames = namesIn(manifest, production ? PROD_FIELDS : ALL_FIELDS)
    if (seedNames.size === 0) continue
    const wsNode = wsNodeByDir.get(dir)
    if (wsNode) {
      // Precise: this workspace's own out-edges (exact resolved versions).
      for (const e of graph.out(wsNode.id)) {
        const dst = graph.getNode(e.target)
        if (dst && seedNames.has(dst.name)) seeds.add(e.target)
      }
    } else {
      // No workspace node (yarn classic v1): resolve declared deps by name + range.
      for (const field of production ? PROD_FIELDS : ALL_FIELDS) {
        const deps = manifest?.[field]
        if (!deps || typeof deps !== 'object') continue
        for (const [name, range] of Object.entries(deps)) {
          const r = normalizeRange(range)
          for (const id of graph.byName(name)) {
            const node = graph.getNode(id)
            if (node && (!r || (sv.valid(node.version) && sv.satisfies(node.version, r))))
              seeds.add(id)
          }
        }
      }
    }
  }

  // Walk out: all edges from a regular node; only production edges from a workspace
  // reached transitively (its dev tree isn't part of the depending closure).
  const inScope = new Set<NodeId>(seeds)
  const queue = [...seeds]
  while (queue.length > 0) {
    const id = queue.pop() as NodeId
    const node = graph.getNode(id)
    if (!node) continue
    let edges = graph.out(id)
    if (node.workspacePath !== undefined) {
      const prod = prodNamesByDir.get(norm(node.workspacePath))
      if (prod)
        edges = edges.filter((e) => {
          const dst = graph.getNode(e.target)
          return dst ? prod.has(dst.name) : false
        })
    }
    for (const e of edges)
      if (!inScope.has(e.target)) {
        inScope.add(e.target)
        queue.push(e.target)
      }
  }
  return inScope
}
