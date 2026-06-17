import { detect, parse as lfParse, stringify as lfStringify } from '@antongolub/lockfile'
import type { Graph, FormatId } from '@antongolub/lockfile'
import sv from 'semver'

import { formatAdvisoryMeta } from './audit/meta'
import { auditViaRegistry } from './audit/registry'
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
  // workspaceRoot lets the berry adapter resolve builtin patch hashes; without
  // it, re-serialised patch entries break `yarn install`.
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
 * Lowest *published* version satisfying `range`. `minVersion` alone can return
 * an unreleased version (a 404), so query the registry; falls back to
 * `minVersion` offline, or undefined when nothing published fits (caller skips).
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

/** Strip yarn's `npm:` protocol; return a usable semver range or undefined. */
const normalizeRange = (raw?: string): string | undefined => {
  if (!raw) return undefined
  const r = raw.startsWith('npm:') ? raw.slice(4) : raw
  return sv.validRange(r) ? r : undefined
}

/**
 * Upgrade every vulnerable node to the lowest published version that clears its
 * advisory, by edge-redirect: add the patched node, repoint incoming edges, drop
 * the old node + tarball. Merged descriptor keys are reconciled by `yarn install`.
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

  // Pass 1: vulnerable nodes with a usable newer fix. Also the exemption set for
  // the compat gate below — a replaced consumer re-declares its own deps.
  type Candidate = { id: string; name: string; version: string; patch?: string; fix: string }
  const candidates: Candidate[] = []
  const noFix = new Set<string>()
  for (const node of graph.nodes()) {
    const advisory = report[node.name]
    if (!advisory) continue
    if (!sv.satisfies(node.version, advisory.vulnerable_versions)) continue

    const fix = resolveFix(node.name, advisory.patched_versions, bins?.npm, cwd, versionCache)
    if (fix === undefined) {
      noFix.add(`${node.name}@${node.version}`) // no published version clears it
      continue
    }
    if (!sv.gt(fix, node.version)) continue // already clean; keeps re-runs idempotent
    candidates.push({ id: node.id, name: node.name, version: node.version, patch: node.patch, fix })
  }
  const candidateIds = new Set(candidates.map((c) => c.id))

  // Pass 2: compat gate. Skip a fix that falls outside a *surviving* consumer's
  // declared range (unless --force), recording why. Candidate consumers are
  // exempt — they'll be replaced and re-declare their deps.
  const upgrades: Candidate[] = []
  const incompatible = new Map<string, Set<string>>()
  for (const c of candidates) {
    let breaks: string[] | undefined
    if (!flags.force) {
      for (const edge of graph.in(c.id)) {
        if (candidateIds.has(edge.src)) continue // consumer is being replaced too
        const range = normalizeRange(edge.attrs?.range)
        if (range && !sv.satisfies(c.fix, range)) {
          (breaks ??= []).push(`${edge.src} wants "${edge.attrs!.range}"`)
        }
      }
    }
    if (breaks?.length) {
      incompatible.set(`${c.name}@${c.version} → ${c.fix}`, new Set(breaks))
      continue
    }
    upgrades.push(c)
  }

  const removedIds = new Set(upgrades.map((u) => u.id))
  const newIdOf = (u: { name: string; fix: string }) => `${u.name}@${u.fix}`
  const sep = String.fromCharCode(0) // NUL — can't occur in a package name

  // Three ordered phases: add nodes, redirect/drop all edges, then remove old
  // nodes. removeNode rejects nodes that still have incoming edges, so batching
  // every edge op before any node removal keeps it order-independent.
  const result = graph.mutate((m) => {
    // 1. Materialise each patched node once.
    const seenIds = new Set<string>()
    for (const u of upgrades) {
      const newId = newIdOf(u)
      if (!graph.getNode(newId) && !seenIds.has(newId)) {
        seenIds.add(newId)
        // Node carries identity only; the lib derives the resolution from
        // name + version + source (a fresh npm fix → `name@npm:version`).
        m.addNode({
          id: newId,
          name: u.name,
          version: u.fix,
          peerContext: [],
        })
      }
    }

    // 2. Drop each removed node's incoming edges; redirect those from surviving
    //    sources onto the patched node (edges between two removed nodes just go).
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

    // 3. Old nodes are edge-free now — drop them and their tarballs (classic has none).
    for (const u of upgrades) {
      m.removeNode(u.id)
      if (graph.tarball({ name: u.name, version: u.version, patch: u.patch })) {
        m.removeTarball({ name: u.name, version: u.version, patch: u.patch })
      }
    }
  })

  if (!flags.silent) {
    // Dedupe by from→to; annotate with severity / CVSS / CVE refs.
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
    if (incompatible.size > 0) {
      console.warn(
        'Skipped (fix breaks a consumer\'s declared range; re-run with --force to apply):',
      )
      for (const [spec, consumers] of [...incompatible].sort()) {
        console.warn(`  ${spec}`)
        for (const c of [...consumers].sort()) console.warn(`    - ${c}`)
      }
    }
    reportDiagnostics(result.unresolved, flags.verbose)
  }

  return result.graph
}

/**
 * Print graph diagnostics: one count per code, or per-entry on verbose. mutate()
 * re-emits parse-time noise (hundreds of lines), so collapse it unless asked.
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
 * Fetch advisories straight from the registry (npm bulk endpoint) for the parsed
 * graph — no `(yarn|npm) audit` child process. Registry / scope / auth resolve
 * from `.npmrc` / `.yarnrc.yml` / `.yarnrc` + env. Async: HTTP can't be done
 * synchronously without spawning, which is exactly what we're moving away from.
 */
export const _audit = (graph: Graph, ctx: TContext): Promise<TAuditReport> =>
  auditViaRegistry(graph, ctx)

// Exposed for test spies.
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
