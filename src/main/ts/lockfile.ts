import { detect, parse as lfParse, stringify as lfStringify } from '@antongolub/lockfile'
import type { Graph, FormatId } from '@antongolub/lockfile'
import sv from 'semver'

import { audit as auditV1 } from './audit/v1'
import { audit as auditV2 } from './audit/v2'
import { audit as auditV4 } from './audit/v4'
import { formatAdvisoryMeta } from './audit/meta'
import {
  TAuditReport,
  TContext,
  TLockfileObject,
  TLockfileType,
} from './ifaces'
import { attempt, invoke } from './util'

export const getLockfileType = (lockfile: string): TLockfileType =>
  detect(lockfile)

export const _parse = (
  lockfile: string,
  lockfileType: TLockfileType,
  workspaceRoot?: string,
): TLockfileObject => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  // workspaceRoot lets the berry adapter resolve yarn's builtin patch hashes;
  // without it re-serialised patch entries break `yarn install`.
  return lfParse(lockfileType as FormatId, lockfile, { workspaceRoot })
}

export const _format = (
  lockfile: TLockfileObject,
  lockfileType: TLockfileType,
): string => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  return lfStringify(lockfileType as FormatId, lockfile as Graph)
}

/**
 * Lowest *published* version satisfying `range`. `minVersion` alone can yield
 * an unreleased version (`>4.17.23` → 4.17.24, a 404), so query the registry
 * and pick the real next release. Falls back to `minVersion` offline; returns
 * undefined when nothing published satisfies (caller skips).
 */
const resolveFix = (
  name: string,
  range: string,
  npmBin: string | undefined,
  cwd: string | undefined,
  cache: Map<string, string[] | null>,
): string | undefined => {
  if (npmBin) {
    if (!cache.has(name)) {
      const out = invoke(
        npmBin,
        ['view', name, 'versions', '--json'],
        cwd ?? process.cwd(),
        true,
        false,
        true, // skipError: offline / 404 → fall through to semver floor
      ) as string
      const parsed = attempt(() => JSON.parse(out)) as string[] | string | null
      cache.set(name, Array.isArray(parsed) ? parsed : (typeof parsed === 'string' ? [parsed] : null))
    }
    const versions = cache.get(name)
    if (versions && versions.length > 0) {
      return versions
        .filter((v) => sv.valid(v) && sv.satisfies(v, range))
        .sort(sv.compare)[0] // undefined ⇒ no published fix
    }
  }
  return sv.minVersion(range)?.format()
}

/**
 * Upgrade every vulnerable node to the lowest published version that clears
 * its advisory, by edge-redirect: add the patched node, repoint incoming
 * edges, drop the old node + tarball. Descriptor keys may merge in the output
 * (`"lodash@npm:4.18.0, lodash@npm:4.17.21"`); `yarn install` reconciles it.
 */
export const _patch = (
  lockfile: TLockfileObject,
  report: TAuditReport,
  { flags, bins, cwd }: TContext,
  _lockfileType: TLockfileType, // eslint-disable-line @typescript-eslint/no-unused-vars
): TLockfileObject => {
  if (Object.keys(report).length === 0) {
    !flags.silent && console.log('Audit check found no issues')
    return lockfile
  }

  const graph = lockfile as Graph
  const versionCache = new Map<string, string[] | null>()

  // Collect upgrades first; mutating mid-iteration would disturb graph.in().
  const upgrades: { id: string; name: string; version: string; patch?: string; fix: string }[] = []
  const noFix = new Set<string>()
  for (const node of graph.nodes()) {
    const advisory = report[node.name]
    if (!advisory) continue
    if (!sv.satisfies(node.version, advisory.vulnerable_versions)) continue

    const fix = resolveFix(node.name, advisory.patched_versions, bins?.npm, cwd, versionCache)
    if (fix === undefined) {
      noFix.add(advisory.module_name) // no published version clears it
      continue
    }
    if (!sv.gt(fix, node.version)) continue // already clean; keeps re-runs idempotent
    upgrades.push({ id: node.id, name: node.name, version: node.version, patch: node.patch, fix })
  }

  const removedIds = new Set(upgrades.map((u) => u.id))
  const newIdOf = (u: { name: string; fix: string }) => `${u.name}@${u.fix}`
  const sep = String.fromCharCode(0) // NUL — can't occur in a package name

  // Three ordered phases. The graph rejects removeNode while a node still has
  // incoming edges, and removeNode auto-drops the node's outgoing edges — so
  // interleaving per-node breaks when a vulnerable parent and child are both
  // upgraded (order-dependent). Doing all edge removals before any node
  // removal is order-independent.
  const result = graph.mutate((m) => {
    // 1. Materialise each patched node once.
    const seenIds = new Set<string>()
    for (const u of upgrades) {
      const newId = newIdOf(u)
      if (!graph.getNode(newId) && !seenIds.has(newId)) {
        seenIds.add(newId)
        m.addNode({
          id: newId,
          name: u.name,
          version: u.fix,
          peerContext: [],
          resolution: `${u.name}@npm:${u.fix}`,
        })
      }
    }

    // 2. Drop every incoming edge of a removed node; redirect those from
    //    surviving sources onto the patched node. Edges between two removed
    //    nodes are just dropped — both endpoints are replaced and yarn install
    //    regenerates deps. Dedupe removals and additions.
    const removedEdges = new Set<string>()
    const addedEdges = new Set<string>()
    for (const u of upgrades) {
      const newId = newIdOf(u)
      for (const edge of graph.in(u.id)) {
        const ekey = [edge.src, edge.dst, edge.kind].join(sep)
        if (!removedEdges.has(ekey)) {
          removedEdges.add(ekey)
          m.removeEdge(edge.src, edge.dst, edge.kind)
        }
        if (removedIds.has(edge.src)) continue
        const akey = [edge.src, newId, edge.kind].join(sep)
        if (!addedEdges.has(akey)) {
          addedEdges.add(akey)
          m.addEdge(edge.src, newId, edge.kind, edge.attrs)
        }
      }
    }

    // 3. Incoming-edge-free now → drop the old nodes and their tarballs
    //    (yarn-classic carries none, so guard).
    for (const u of upgrades) {
      m.removeNode(u.id)
      if (graph.tarball({ name: u.name, version: u.version, patch: u.patch })) {
        m.removeTarball({ name: u.name, version: u.version, patch: u.patch })
      }
    }
  })

  if (!flags.silent) {
    // Dedupe by from→to (one node spans many descriptors); annotate each with
    // the advisory severity / CVSS / CVE refs that motivated the bump.
    const seen = new Set<string>()
    const lines: string[] = []
    for (const u of upgrades) {
      const head = `${u.name}@${u.version} → ${u.fix}`
      if (seen.has(head)) continue
      seen.add(head)
      lines.push(head + formatAdvisoryMeta(report[u.name]))
    }
    lines.sort()
    if (lines.length > 0) {
      console.log(`Upgraded deps (${lines.length}):`)
      for (const line of lines) console.log(`  ${line}`)
    } else {
      console.log('Upgraded deps: <none>')
    }
    if (noFix.size > 0) {
      console.log('No fix available:', [...noFix].sort().join(', '))
    }
    reportDiagnostics(result.unresolved, flags.verbose)
  }

  return result.graph
}

/**
 * Print graph diagnostics: a count per code by default, per-entry on verbose.
 * mutate() re-emits parse-time noise (e.g. one YARN_CLASSIC_INVALID_INTEGRITY
 * per legacy sha1 — hundreds), so collapse it unless asked.
 */
const reportDiagnostics = (
  diagnostics: readonly { severity: string; code: string; message: string }[],
  verbose?: boolean,
): void => {
  if (diagnostics.length === 0) return

  if (verbose) {
    for (const d of diagnostics) {
      console.warn(`  [${d.severity}] ${d.code}: ${d.message}`)
    }
    return
  }

  const counts = new Map<string, number>()
  for (const d of diagnostics) {
    counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  }
  for (const [code, n] of counts) {
    console.warn(`  ${n}× ${code}${n > 1 ? ' (run with --verbose for details)' : ''}`)
  }
}

/**
 * Audit dispatch by yarn *binary* version (not lockfile schema) — the binary
 * decides the output shape, and yarn 4 has no `yarn audit`, only `yarn npm
 * audit`, so a classic lockfile on a yarn-4 host must still take v4:
 *   yarn 4+ → v4 (NDJSON) · yarn 2/3 → v2 (JSON) · yarn 1 / npm → v1
 */
export const _audit = (
  { flags, temp, bins, versions }: TContext,
  _lockfileType: TLockfileType, // eslint-disable-line @typescript-eslint/no-unused-vars
): TAuditReport => {
  const yarn = versions?.yarn
  if (yarn && sv.gte(yarn, '4.0.0')) return auditV4(flags, temp, bins)
  if (yarn && sv.gte(yarn, '2.0.0')) return auditV2(flags, temp, bins)
  return auditV1(flags, temp, bins)
}

// FIXME Jest cannot mock esm yet
// https://github.com/facebook/jest/commit/90d6908492d164392ce8429923e7f0fa17946d2d
export const _internal = {
  _parse,
  _audit,
  _patch,
  _format,
}

export const parse: typeof _parse = (...args) => _internal._parse(...args)
export const audit: typeof _audit = (...args) => _internal._audit(...args)
export const patch: typeof _patch = (...args) => _internal._patch(...args)
export const format: typeof _format = (...args) => _internal._format(...args)
