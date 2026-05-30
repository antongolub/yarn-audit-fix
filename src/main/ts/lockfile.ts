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

export const getLockfileType = (lockfile: string): TLockfileType =>
  detect(lockfile)

export const _parse = (
  lockfile: string,
  lockfileType: TLockfileType,
): TLockfileObject => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  return lfParse(lockfileType as FormatId, lockfile)
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
 * Patch a lockfile graph by upgrading every node that matches an audit
 * advisory to `minVersion(patched_versions)`.
 *
 * Strategy: edge-redirect. For each vulnerable node we
 *   1. add (or reuse) a node at the patched version,
 *   2. redirect every incoming edge from the old node to the new one, and
 *   3. drop the old node + its tarball payload.
 *
 * This is the canonical Graph-model expression of an audit-fix, replacing
 * the legacy in-place "rewrite version, clear checksum" hack. The trade-off
 * is that descriptor keys merge in the rendered YAML (e.g.
 * `"lodash@npm:4.17.21, lodash@npm:4.17.20"`) — semantically honest but
 * visually different from the old output. The subsequent `yarn install`
 * stage reconciles the result.
 */
export const _patch = (
  lockfile: TLockfileObject,
  report: TAuditReport,
  { flags }: TContext,
  _lockfileType: TLockfileType, // eslint-disable-line @typescript-eslint/no-unused-vars
): TLockfileObject => {
  if (Object.keys(report).length === 0) {
    !flags.silent && console.log('Audit check found no issues')
    return lockfile
  }

  const graph = lockfile as Graph

  // Pass 1: collect (node, patched-version) pairs. Iterating then mutating
  // keeps the read view stable for `graph.in(...)` lookups.
  const upgrades: { id: string; name: string; version: string; patch?: string; fix: string }[] = []
  for (const node of graph.nodes()) {
    const advisory = report[node.name]
    if (!advisory) continue
    if (!sv.satisfies(node.version, advisory.vulnerable_versions)) continue

    const fix = sv.minVersion(advisory.patched_versions)?.format()
    if (fix === undefined) {
      console.error(
        "Can't find satisfactory version for",
        advisory.module_name,
        advisory.patched_versions,
      )
      continue
    }
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
    for (const d of result.unresolved) {
      console.warn(`  [${d.severity}] ${d.code}: ${d.message}`)
    }
  }

  return result.graph
}

/**
 * Audit dispatch — orthogonal to the lockfile model.
 *
 * Berry schemas split between the yarn 2/3 audit shape (single
 * `{advisories: …}` JSON) and the yarn 4+ shape (NDJSON, no
 * `patched_versions`). Lockfile-schema-driven dispatch matches default
 * writers: yarn ≤3.x emits v3–v6, yarn ≥4 emits v8+. (v7 was skipped by
 * yarn itself, but `@antongolub/lockfile` accepts it for pre-release
 * compatibility — route it through v4 since any tooling producing v7 is
 * yarn-4-class.)
 */
const V2_BERRY_SCHEMAS = new Set([
  'yarn-berry-v3',
  'yarn-berry-v4',
  'yarn-berry-v5',
  'yarn-berry-v6',
])

export const _audit = (
  { flags, temp, bins }: TContext,
  lockfileType: TLockfileType,
): TAuditReport => {
  if (lockfileType && V2_BERRY_SCHEMAS.has(lockfileType)) {
    return auditV2(flags, temp, bins)
  }
  if (typeof lockfileType === 'string' && lockfileType.startsWith('yarn-berry-')) {
    return auditV4(flags, temp, bins)
  }
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
