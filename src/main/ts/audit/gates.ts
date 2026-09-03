import sv from 'semver'

import type { Graph } from 'lockgraph'

import type { Ledger, Plan } from './report'
import type { TContext } from '../ifaces'
import { normalizeRange } from './plan'

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
