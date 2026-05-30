import { detect, parse as lfParse, stringify as lfStringify } from '@antongolub/lockfile'
import type { Graph, FormatId } from '@antongolub/lockfile'
import sv from 'semver'

import { audit as auditV1 } from './audit/v1'
import { audit as auditV2 } from './audit/v2'
import { audit as auditV4 } from './audit/v4'
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
  // NOTE workspaceRoot lets the berry adapter resolve yarn's builtin patch
  // hashes (compat/typescript, compat/resolve, compat/fsevents). Without it
  // the parser falls back to a sentinel hash; mutating + re-serialising then
  // emits patch entries that `yarn install` can't resolve
  // ("This package doesn't seem to be present in your lockfile").
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
 * Resolve the lowest **published** version that satisfies `range`.
 *
 * `minVersion` alone is not enough: a patched range derived from an
 * inclusive vulnerable bound (`<=4.17.23` → `>4.17.23`) points at a version
 * that may have never been released (4.17.24), which 404s on `yarn install`.
 * Querying `npm view <name> versions` lets us snap to the real next release
 * (4.18.0) and keeps the operation idempotent — a re-run finds the package
 * already at a non-vulnerable version and leaves it alone.
 *
 * Falls back to `minVersion(range)` when the registry can't be reached
 * (offline / no npm bin), preserving the previous pure-semver behaviour.
 * Returns `undefined` when the registry is reachable but nothing published
 * satisfies the range (genuinely unfixable — caller skips the entry).
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
      const satisfying = versions
        .filter((v) => sv.valid(v) && sv.satisfies(v, range))
        .sort(sv.compare)
      return satisfying[0] // undefined ⇒ no published fix ⇒ caller skips
    }
  }
  return sv.minVersion(range)?.format()
}

/**
 * Patch a lockfile graph by upgrading every node that matches an audit
 * advisory to the lowest published version that clears it.
 *
 * Strategy: edge-redirect. For each vulnerable node we
 *   1. add (or reuse) a node at the patched version,
 *   2. redirect every incoming edge from the old node to the new one, and
 *   3. drop the old node + its tarball payload.
 *
 * This is the canonical Graph-model expression of an audit-fix, replacing
 * the legacy in-place "rewrite version, clear checksum" hack. The trade-off
 * is that descriptor keys merge in the rendered YAML (e.g.
 * `"lodash@npm:4.18.0, lodash@npm:4.17.21"`) — semantically honest but
 * visually different from the old output. The subsequent `yarn install`
 * stage reconciles the result.
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

  // Pass 1: collect (node, patched-version) pairs. Iterating then mutating
  // keeps the read view stable for `graph.in(...)` lookups.
  const upgrades: { id: string; name: string; version: string; patch?: string; fix: string }[] = []
  for (const node of graph.nodes()) {
    const advisory = report[node.name]
    if (!advisory) continue
    if (!sv.satisfies(node.version, advisory.vulnerable_versions)) continue

    const fix = resolveFix(node.name, advisory.patched_versions, bins?.npm, cwd, versionCache)
    if (fix === undefined) {
      console.error(
        "Can't find satisfactory version for",
        advisory.module_name,
        advisory.patched_versions,
      )
      continue
    }
    // Already at (or above) a clean version — nothing to do. Keeps re-runs
    // idempotent and avoids needless descriptor-key churn.
    if (!sv.gt(fix, node.version)) continue
    upgrades.push({ id: node.id, name: node.name, version: node.version, patch: node.patch, fix })
  }

  const result = graph.mutate((m) => {
    const seenIds = new Set<string>()
    for (const { id, name, version, patch, fix } of upgrades) {
      const newId = `${name}@${fix}`

      // Add the patched node if neither the graph nor an earlier upgrade in
      // this same transaction has already materialised it.
      if (!graph.getNode(newId) && !seenIds.has(newId)) {
        seenIds.add(newId)
        m.addNode({
          id: newId,
          name,
          version: fix,
          peerContext: [],
          resolution: `${name}@npm:${fix}`,
        })
      }

      // Redirect every incoming edge to the patched node, preserving range
      // attrs so downstream `yarn install` can refresh descriptors.
      for (const edge of graph.in(id)) {
        m.removeEdge(edge.src, edge.dst, edge.kind)
        m.addEdge(edge.src, newId, edge.kind, edge.attrs)
      }
      m.removeNode(id)
      // yarn-classic doesn't carry per-node tarball payloads, so only drop
      // the tarball when one was actually registered by the parser.
      if (graph.tarball({ name, version, patch })) {
        m.removeTarball({ name, version, patch })
      }
    }
  })

  if (!flags.silent) {
    const summary = upgrades.length > 0
      ? upgrades.map((u) => `${u.name}@${u.fix}`).join(', ')
      : '<none>'
    console.log('Upgraded deps:', summary)
    reportDiagnostics(result.unresolved, flags.verbose)
  }

  return result.graph
}

/**
 * Surface graph diagnostics without flooding the console.
 *
 * `graph.mutate()` re-emits parse-time diagnostics too — notably yarn-classic
 * lockfiles raise one `YARN_CLASSIC_INVALID_INTEGRITY` per legacy sha1 hash
 * (hundreds in a real lockfile). Those are converter artefacts, not audit-fix
 * problems, and yarn regenerates the integrity on the subsequent install — so
 * by default we print a one-line count per code and reserve the per-entry
 * detail for `--verbose`.
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
 * Audit dispatch — orthogonal to the lockfile model.
 *
 * Which audit *output shape* we get is decided by the yarn binary running
 * the command, NOT by the lockfile schema on disk:
 *   - yarn 4+ emits NDJSON, drops `patched_versions`           → audit/v4
 *   - yarn 2/3 emits `{advisories: …}` JSON                    → audit/v2
 *   - yarn 1 / npm emits a stream of `auditAdvisory` events    → audit/v1
 *
 * Dispatching by yarn binary version (rather than by lockfile schema)
 * handles the "yarn 4 running against a yarn-classic lockfile" case
 * correctly — yarn 4 has no `yarn audit` command, only `yarn npm audit`,
 * so routing classic lockfiles through v1 would silently no-op on a
 * yarn-4 host. When yarn isn't available at all (e.g. npm flow,
 * `--reporter=npm`), v1's `npm audit` invocation still applies.
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
