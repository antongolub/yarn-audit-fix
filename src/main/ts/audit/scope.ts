import { globToRegExp, split } from './filter'
import { seedRoots, walkClosure } from './closure'
import type { Graph } from 'lockgraph'

import { PROD_FIELDS, dirOf, namesIn, norm, truthy } from './scope-util'
import type { GNode, NodeId, TManifestFile } from './scope-util'

export type { TManifestFile }

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
/**
 * Which workspace dirs `--workspace` selects: globs match a workspace's manifest
 * name, its dir, or the dir's basename. No patterns → every manifest. Throws on a
 * pattern that matches nothing (a typo shouldn't silently fix nothing).
 */
const selectWorkspaceDirs = (
  patterns: string[],
  manifestByDir: Map<string, Record<string, any>>,
): string[] => {
  // Which workspace dirs are in scope: `--workspace` globs match a workspace's
  // manifest name, its dir, or the dir's basename; absent → every manifest.
  let selected: string[]
  if (patterns.length > 0) {
    const globs = patterns.map(globToRegExp)
    selected = [...manifestByDir]
      .filter(([dir, manifest]) => {
        const ids = [manifest?.name, dir, dir.split('/').pop()].filter(
          (x): x is string => typeof x === 'string' && x !== '',
        )
        return ids.some((id) => globs.some((g) => g.test(id)))
      })
      .map(([dir]) => dir)
    if (selected.length === 0)
      throw new Error(
        `--workspace matched no workspaces: ${patterns.join(', ')}`,
      )
  } else {
    selected = [...manifestByDir.keys()]
  }
  return selected
}

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

  const selected = selectWorkspaceDirs(patterns, manifestByDir)

  // Production-dep names per workspace dir — the walk consults these when it reaches
  // a workspace as a dependency (expand its prod edges only).
  const prodNamesByDir = new Map<string, Set<string>>()
  for (const [dir, manifest] of manifestByDir)
    prodNamesByDir.set(dir, namesIn(manifest, PROD_FIELDS))

  const seeds = seedRoots(
    graph,
    selected,
    manifestByDir,
    wsNodeByDir,
    production,
  )

  return walkClosure(graph, seeds, prodNamesByDir)
}
