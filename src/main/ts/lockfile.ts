import { detect, parse as lfParse, stringify as lfStringify } from '@antongolub/lockfile'
import type { Graph, FormatId } from '@antongolub/lockfile'
import { completeTransitives } from '@antongolub/lockfile/complete'
import { refurbish as lfRefurbish } from '@antongolub/lockfile/enrich'
import { replaceVersion } from '@antongolub/lockfile/modify'
import { pruneOrphans } from '@antongolub/lockfile/optimize'
import sv from 'semver'

import { buildRegistry, buildTarballSource } from './audit/adapter'
import { matchesPackage, parsePackageRules } from './audit/filter'
import { formatAdvisoryMeta } from './audit/meta'
import { auditViaRegistry } from './audit/registry'
import {
  TAuditReport,
  TContext,
  TLockfileObject,
  TLockfileType,
} from './ifaces'

// NodeId isn't re-exported from the package root — derive it from a primitive.
type NodeId = Awaited<ReturnType<typeof replaceVersion>>['added'][number]

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

/** Strip yarn's `npm:` protocol; return a usable semver range or undefined. */
const normalizeRange = (raw?: string): string | undefined => {
  if (!raw) return undefined
  const r = raw.startsWith('npm:') ? raw.slice(4) : raw
  return sv.validRange(r) ? r : undefined
}

/**
 * Upgrade every vulnerable node to the lowest published version that clears its
 * advisory — then pull in that version's *new* transitive dependency closure so
 * the lockfile stays complete. Versions resolve from the registry packument
 * (no shell-out); `replaceVersion` rebinds, `completeTransitives` fills the new
 * deps, `pruneOrphans` retires the old closure the upgrade stranded. Async since
 * the registry is hit over HTTP.
 */
export const _patch = async (
  lockfile: TLockfileObject,
  report: TAuditReport,
  ctx: TContext,
  _lockfileType: TLockfileType, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<TLockfileObject> => {
  const { flags } = ctx
  if (Object.keys(report).length === 0) {
    !flags.silent && console.log('Audit check found no issues')
    return lockfile
  }

  let graph = lockfile as Graph
  const registry = buildRegistry(ctx)
  const excludeRules = parsePackageRules(flags.exclude)
  const excluded = new Set<string>()
  const noFix = new Set<string>()
  const incompatible = new Map<string, Set<string>>()

  // Lowest published version that clears the advisory (minimal bump), read from
  // the registry packument.
  const packCache = new Map<string, Awaited<ReturnType<typeof registry.packument>>>()
  const lowestFix = async (
    name: string,
    range: string,
  ): Promise<string | undefined> => {
    if (!packCache.has(name)) packCache.set(name, await registry.packument(name))
    const pack = packCache.get(name)
    if (!pack) return undefined
    return Object.keys(pack.versions)
      .filter((v) => sv.valid(v) && sv.satisfies(v, range))
      .sort(sv.compare)[0] // undefined ⇒ nothing published clears it
  }

  type Plan = {
    name: string
    fromRange: string
    fix: string
    froms: { id: NodeId; version: string }[]
  }

  // Pass 1: per vulnerable package, resolve the minimal fix and the nodes to bump.
  const plans: Plan[] = []
  const advisoryCount = Object.keys(report).length
  let resolving = 0
  for (const [name, advisory] of Object.entries(report)) {
    ctx.progress?.label(`Resolving fixes… ${++resolving}/${advisoryCount}`)
    const vuln = [...graph.nodes()].filter(
      (n) =>
        n.name === name && sv.satisfies(n.version, advisory.vulnerable_versions),
    )
    if (vuln.length === 0) continue

    const kept = vuln.filter((n) => {
      if (
        excludeRules.length > 0 &&
        matchesPackage(n.name, n.version, excludeRules)
      ) {
        excluded.add(`${n.name}@${n.version}`)
        return false
      }
      return true
    })
    if (kept.length === 0) continue

    const fix = await lowestFix(name, advisory.patched_versions)
    if (fix === undefined) {
      kept.forEach((n) => noFix.add(`${n.name}@${n.version}`))
      continue
    }
    // skip versions already at/above the fix — keeps re-runs idempotent
    const froms = kept.filter((n) => sv.lt(n.version, fix))
    if (froms.length === 0) continue

    plans.push({
      name,
      fromRange: advisory.vulnerable_versions,
      fix,
      froms: froms.map((n) => ({ id: n.id as NodeId, version: n.version })),
    })
  }

  // Pass 2: compat gate. Skip a fix outside a *surviving* consumer's declared
  // range (unless --force); a consumer that is itself being bumped is exempt —
  // replaceVersion + completeTransitives re-derive its deps from the registry.
  const planNames = new Set(plans.map((p) => p.name))
  const upgrades: Plan[] = []
  for (const p of plans) {
    let breaks: Set<string> | undefined
    if (!flags.force) {
      for (const from of p.froms) {
        for (const edge of graph.in(from.id)) {
          const consumer = graph.getNode(edge.src)
          if (consumer && planNames.has(consumer.name)) continue // bumped too
          const range = normalizeRange(edge.attrs?.range)
          if (range && !sv.satisfies(p.fix, range)) {
            ;(breaks ??= new Set()).add(`${edge.src} wants "${edge.attrs!.range}"`)
          }
        }
      }
    }
    if (breaks?.size) {
      incompatible.set(`${p.name}@${p.froms[0].version} → ${p.fix}`, breaks)
      continue
    }
    upgrades.push(p)
  }

  // Snapshot pre-existing danglers (in-degree 0 in the *parsed* lock) so the final
  // prune PRESERVES them: yarn's `--immutable` keeps base danglers, but an unseeded
  // prune would GC them → divergence (YN0028, e.g. redwood's `@types/keyv`). The
  // bump's own stranded closure is NOT in this set (those nodes had an edge at
  // parse → in-degree > 0), so it's still pruned. (= `pruneOrphans` mode "b".)
  const preExistingDanglers = new Set<NodeId>(
    [...graph.nodes()]
      .filter((n) => graph.in(n.id as NodeId).length === 0)
      .map((n) => n.id as NodeId),
  )

  // Apply: rebind each vulnerable range to its fix, then complete the new
  // transitive closure, then drop whatever got orphaned.
  const recentlyAdded = new Set<NodeId>()
  const recentlyOrphaned = new Set<NodeId>()
  for (const u of upgrades) {
    const res = await replaceVersion(
      graph,
      { name: u.name, fromRange: u.fromRange },
      u.fix,
      { registry },
    )
    graph = res.graph
    res.added.forEach((id) => recentlyAdded.add(id))
    res.removed.forEach((id) => recentlyOrphaned.add(id))
  }

  let completionDiagnostics: readonly {
    severity: string
    code: string
    message: string
  }[] = []
  if (recentlyAdded.size > 0 || recentlyOrphaned.size > 0) {
    // Live count of nodes pulled in (the slow part — a packument fetch each).
    let completed = 0
    const completion = await completeTransitives(graph, registry, {
      seed: { recentlyAdded, recentlyOrphaned },
      onDiagnostic: (d: { code?: string }) => {
        if (d.code === 'COMPLETION_NODE_ADDED')
          ctx.progress?.label(`Completing the tree… ${++completed}`)
      },
    })
    graph = completion.graph
    completionDiagnostics = completion.unresolved
    // completeTransitives is additive, so a dep-changing upgrade leaves the *old*
    // closure behind as orphans → `yarn install --immutable` would reject them.
    // Sweep them with `pruneOrphans` (ref-counted: removes only nodes with no
    // remaining incoming edge + the closure they strand), but `preserve` the
    // pre-existing danglers so we never GC a node yarn keeps (referenced nodes —
    // incl. fsevents builtin-patch bases + `catalog:` targets — stay either way).
    // A yarn-classic lock has no workspace-root node, so this NO_ROOTS-noops there.
    graph = pruneOrphans(graph, { preserve: preExistingDanglers }).graph
  }

  if (!flags.silent) {
    // Route through the spinner when one is active (clears → prints → redraws);
    // plain console otherwise (direct/test calls).
    const log = ctx.progress ? ctx.progress.log : console.log
    const warn = ctx.progress ? ctx.progress.log : console.warn
    // Dedupe by from→to; annotate with severity / CVSS / CVE refs.
    const seen = new Set<string>()
    const lines: string[] = []
    for (const u of upgrades) {
      const head = `${u.name}@${u.froms[0].version} → ${u.fix}`
      if (seen.has(head)) continue
      seen.add(head)
      lines.push(head + formatAdvisoryMeta(report[u.name]))
    }
    lines.sort()
    if (lines.length > 0) {
      log(`Upgraded deps (${lines.length}):`)
      for (const line of lines) log(`  ${line}`)
    } else {
      log('Upgraded deps: <none>')
    }
    if (noFix.size > 0) {
      log('No fix available: ' + [...noFix].sort().join(', '))
    }
    if (excluded.size > 0) {
      log('Excluded (per --exclude): ' + [...excluded].sort().join(', '))
    }
    if (incompatible.size > 0) {
      warn(
        'Skipped (fix breaks a consumer\'s declared range; re-run with --force to apply):',
      )
      for (const [spec, consumers] of [...incompatible].sort()) {
        warn(`  ${spec}`)
        for (const c of [...consumers].sort()) warn(`    - ${c}`)
      }
    }
    // info-level COMPLETION_NODE_ADDED is success noise — only surface real gaps.
    reportDiagnostics(
      completionDiagnostics.filter((d) => d.severity !== 'info'),
      flags.verbose,
      warn,
    )
  }

  return graph
}

/**
 * Fill install-required fields the patched graph still lacks, so the written
 * lockfile needs no reconcile `yarn install`. Today that's only the yarn-berry
 * zip `checksum`: `completeTransitives` resolves new nodes' `integrity` from the
 * packument, but the berry `checksum` is a hash of yarn's *own* zip, derivable
 * only from the tarball bytes — so `refurbish` fetches them and recomputes
 * (byte-identical to what `yarn install` would write). yarn-classic nodes are
 * already complete (resolved + integrity), so it's a no-op there. Async (HTTP).
 */
export const _refurbish = async (
  lockfile: TLockfileObject,
  lockfileType: TLockfileType,
  ctx: TContext,
): Promise<TLockfileObject> => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  if (!lockfileType.startsWith('yarn-berry')) return lockfile

  const source = buildTarballSource(ctx)
  // Live count of recomputed checksums — the tarball fetches are the slowest
  // phase, so surface progress as each one lands.
  let filled = 0
  const result = await lfRefurbish(lockfile as Graph, lockfileType as FormatId, source, {
    onDiagnostic: (d: { code?: string }) => {
      if (d.code === 'ENRICH_FIELD_FILLED')
        ctx.progress?.label(`Recomputing checksums… ${++filled}`)
    },
  })

  if (!ctx.flags.silent) {
    const warn = ctx.progress ? ctx.progress.log : console.warn
    // `unresolved` carries *every* diagnostic, including successful fills — so
    // surface only genuine gaps: a node whose checksum couldn't be recomputed
    // (git / private / workspace deps with no fetchable tarball). Those still
    // need a real `yarn install` to finish the lockfile.
    const deferred = result.unresolved.filter(
      (d) => d.code === 'ENRICH_CHECKSUM_DEFERRED',
    )
    if (deferred.length > 0) {
      warn(
        `Could not compute checksums for ${deferred.length} package(s) with no fetchable tarball — run \`yarn install\` to finish the lockfile:`,
      )
      reportDiagnostics(deferred, ctx.flags.verbose, warn)
    }
  }

  return result.graph as TLockfileObject
}

/**
 * Print graph diagnostics: one count per code, or per-entry on verbose. mutate()
 * re-emits parse-time noise (hundreds of lines), so collapse it unless asked.
 */
const reportDiagnostics = (
  diagnostics: readonly { severity: string; code: string; message: string }[],
  verbose?: boolean,
  log: (line: string) => void = console.warn,
): void => {
  if (diagnostics.length === 0) return

  if (verbose) {
    for (const d of diagnostics) {
      log(`  [${d.severity}] ${d.code}: ${d.message}`)
    }
    return
  }

  const counts = new Map<string, number>()
  for (const d of diagnostics) {
    counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  }
  for (const [code, n] of counts) {
    log(`  ${n}× ${code}${n > 1 ? ' (run with --verbose for details)' : ''}`)
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
  _refurbish,
  _format,
}

export const parse: typeof _parse = (...args) => _internal._parse(...args)
export const audit: typeof _audit = (...args) => _internal._audit(...args)
export const patch: typeof _patch = (...args) => _internal._patch(...args)
export const refurbish: typeof _refurbish = (...args) =>
  _internal._refurbish(...args)
export const format: typeof _format = (...args) => _internal._format(...args)
