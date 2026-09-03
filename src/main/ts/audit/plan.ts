import sv from 'semver'

import type { Graph, NodeId, OverrideConstraint } from 'lockgraph'

import { matchesPackage, parsePackageRules } from './filter'

import type { Ledger, Plan } from './report'
import { TAuditReport, TContext } from '../ifaces'

/** Strip yarn's `npm:` protocol; return a usable semver range or undefined. */
const normalizeRange = (raw?: string): string | undefined => {
  if (!raw) return undefined
  const r = raw.startsWith('npm:') ? raw.slice(4) : raw
  return sv.validRange(r) ? r : undefined
}

/** Widen a declared range to admit `fix`, preserving the pin operator
 * (`^`/`~`/exact; anything else → caret): `4.17.11`→`4.18.0`, `~4.1`→`~4.18.0`. */
const widenRange = (declared: string, fix: string): string => {
  const t = declared.trim()
  const op = t.startsWith('^')
    ? '^'
    : t.startsWith('~')
      ? '~'
      : /^\d/.test(t)
        ? ''
        : '^'
  return op + fix
}

/**
 * Drop the vulnerable nodes this run must not touch — matched by `--exclude`, or
 * outside the `--production` / `--workspace` scope — recording each in its ledger so
 * the report can explain the omission.
 */
export const keepInScope = <
  T extends { id: unknown; name: string; version: string },
>(
  vuln: readonly T[],
  excludeRules: ReturnType<typeof parsePackageRules>,
  inScope: ReadonlySet<NodeId> | undefined,
  excluded: Set<string>,
  scopeSkipped: Set<string>,
): T[] =>
  vuln.filter((n) => {
    if (
      excludeRules.length > 0 &&
      matchesPackage(n.name, n.version, excludeRules)
    ) {
      excluded.add(`${n.name}@${n.version}`)
      return false
    }
    if (inScope && !inScope.has(n.id as NodeId)) {
      scopeSkipped.add(`${n.name}@${n.version}`)
      return false
    }
    return true
  })

/**
 * Consumers whose declared range the fix would fall outside of. A consumer that is
 * itself being bumped is exempt — its deps get re-derived from the registry.
 */
const consumersBrokenBy = (
  graph: Graph,
  p: Plan,
  planNames: ReadonlySet<string>,
): Set<string> | undefined => {
  let breaks: Set<string> | undefined
  for (const from of p.froms)
    for (const edge of graph.in(from.id)) {
      const consumer = graph.getNode(edge.source)
      if (consumer && planNames.has(consumer.name)) continue // bumped too
      const range = normalizeRange(edge.attributes?.range)
      if (range && !sv.satisfies(p.fix, range))
        (breaks ??= new Set()).add(
          `${edge.source} wants "${edge.attributes!.range}"`,
        )
    }
  return breaks
}

/**
 * Pass 1 — for each advisory: find the vulnerable nodes, drop the ones `--exclude`
 * or the fix scope rules out, resolve the minimal published fix, and honor a
 * declared override that the fix cannot satisfy. Records every skip in `ledger`.
 */
/**
 * Override authority (`npm audit fix --force` parity): a root override / resolution
 * is the user's deliberate pin. Returns the pinned target when it governs `name` and
 * the fix can't satisfy it — the package is then left untouched and reported, because
 * npm does not rewrite an override even under `--force`. Returns `undefined` when no
 * pin governs it, or when a range pin ADMITS the fix (the bump stays inside it).
 */
export const blockingOverride = (
  graph: Graph,
  name: string,
  kept: readonly { id: unknown; name: string; version: string }[],
  overrides: readonly OverrideConstraint[],
  fix: string,
): string | undefined => {
  if (overrides.length === 0) return undefined
  let pinTo = graph.governingOverride(name, [])?.to // bare / tree-wide
  if (pinTo === undefined) {
    // single-parent-scoped (matches the lib's consumerPath = [immediate parent])
    pinScan: for (const n of kept) {
      for (const e of graph.in(n.id as NodeId)) {
        const consumer = graph.getNode(e.source)
        const g = consumer && graph.governingOverride(name, [consumer.name])
        if (g) {
          pinTo = g.to
          break pinScan
        }
      }
    }
  }
  // v1 safety: the lib's matcher only sees one consumer level, so a DEEP scope
  // (>=2 ancestors, e.g. npm `a>b>foo`) under-matches. We can't prove which subtree
  // it governs -> treat it as authoritative-but-unverifiable and leave the package
  // be, rather than emit a bump a deep override could revert on install. (Drop this
  // once the lib threads a full consumer path.)
  if (pinTo === undefined)
    return overrides.find(
      (c) => c.name === name && (c.parentPath?.length ?? 0) >= 2,
    )?.to
  // A range pin that ADMITS the fix falls through (bump stays within it); an exact /
  // non-semver pin the fix can't satisfy is left as-is.
  const pinRange = normalizeRange(pinTo)
  return pinRange === undefined || !sv.satisfies(fix, pinRange)
    ? pinTo
    : undefined
}

export const planUpgrades = async (
  graph: Graph,
  report: TAuditReport,
  ctx: TContext,
  overrides: readonly OverrideConstraint[],
  inScope: ReadonlySet<NodeId> | undefined,
  excludeRules: ReturnType<typeof parsePackageRules>,
  lowestFix: (name: string, range: string) => Promise<string | undefined>,
  ledger: Ledger,
): Promise<Plan[]> => {
  const { excluded, noFix, scopeSkipped, pinned } = ledger
  // Pass 1: per vulnerable package, resolve the minimal fix and the nodes to bump.
  const plans: Plan[] = []
  const advisoryCount = Object.keys(report).length
  let resolving = 0
  for (const [name, advisory] of Object.entries(report)) {
    ctx.progress?.label(`Resolving fixes… ${++resolving}/${advisoryCount}`)
    const vuln = [...graph.nodes()].filter(
      (n) =>
        n.name === name &&
        sv.satisfies(n.version, advisory.vulnerable_versions),
    )
    if (vuln.length === 0) continue

    const kept = keepInScope(
      vuln,
      excludeRules,
      inScope,
      excluded,
      scopeSkipped,
    )
    if (kept.length === 0) continue

    const fix = await lowestFix(name, advisory.patched_versions)
    if (fix === undefined) {
      kept.forEach((n) => noFix.add(`${n.name}@${n.version}`))
      continue
    }

    const blockedBy = blockingOverride(graph, name, kept, overrides, fix)
    if (blockedBy !== undefined) {
      kept.forEach((n) => pinned.set(`${n.name}@${n.version}`, blockedBy))
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
  return plans
}

/**
 * A DIRECT dep whose declared package.json range can't admit the fix. Default →
 * flag + skip (surface it, the engineer widens the range); `--force` → rewrite the
 * range in each declaring manifest and let the bump proceed.
 */
export const gateByManifest = (
  plans: readonly Plan[],
  directRanges: Map<string, { range: string; file: string }[]>,
  flags: TContext['flags'],
  ledger: Ledger,
): Plan[] => {
  const { manifestPinned, manifestEdits } = ledger
  // Manifest gate: a DIRECT dep whose declared package.json range can't admit the
  // fix. Default → flag + skip (like `npm audit fix` without --force: surface it,
  // the engineer widens the range). --force → rewrite the range in package.json
  // (npm audit fix --force parity) + let the bump proceed. Works for EVERY format:
  // a yarn-classic lock has no root edge, so Pass 2's edge gate can't see direct
  // deps — this can. Non-semver ranges (workspace:/npm:alias/git/file) skip via the
  // validRange guard; `*` admits every fix so it never trips.
  const gatedPlans: Plan[] = []
  for (const p of plans) {
    // Every declaration (root + workspaces) whose declared range can't admit the
    // fix — a semver-major bump outside a `^`/exact pin, in any manifest.
    const blocking = (directRanges.get(p.name) ?? []).filter(
      (d) => sv.validRange(d.range) && !sv.satisfies(p.fix, d.range),
    )
    if (blocking.length > 0) {
      if (!flags.force) {
        manifestPinned.set(p.name, blocking)
        continue
      }
      for (const d of blocking)
        manifestEdits.push({
          name: p.name,
          from: d.range,
          to: widenRange(d.range, p.fix),
          file: d.file,
        })
    }
    gatedPlans.push(p)
  }
  return gatedPlans
}

/**
 * Pass 2 — skip a fix that falls outside a *surviving* consumer's declared range
 * (unless `--force`). A consumer that is itself being bumped is exempt: its deps are
 * re-derived from the registry.
 */
export const gateByConsumers = (
  graph: Graph,
  gatedPlans: readonly Plan[],
  flags: TContext['flags'],
  ledger: Ledger,
): Plan[] => {
  const { incompatible } = ledger
  const planNames = new Set(gatedPlans.map((p) => p.name))
  const upgrades: Plan[] = []
  for (const p of gatedPlans) {
    const breaks = flags.force
      ? undefined
      : consumersBrokenBy(graph, p, planNames)
    if (breaks?.size) {
      incompatible.set(`${p.name}@${p.froms[0].version} → ${p.fix}`, breaks)
      continue
    }
    upgrades.push(p)
  }
  return upgrades
}
