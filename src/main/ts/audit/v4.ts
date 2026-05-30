import sv from 'semver'

import {
  TAuditReport,
  TFlags,
} from '../ifaces'
import { attempt, invoke } from '../util'
import { auditFlags } from './v2'

/**
 * Yarn 4+ audit invocation (`yarn npm audit --all --json --recursive`).
 * Output is **NDJSON** — one yarn-tree node per line, of the form
 * `{value: <pkgName>, children: {ID, "Vulnerable Versions", Severity,
 * URL, "Tree Versions", Dependents}}`.
 *
 * Notable change from yarn 2/3: the explicit `patched_versions` field is
 * gone. We derive it from the `Vulnerable Versions` upper bound — see
 * `derivePatchedVersions` below.
 */
export const audit = (
  flags: TFlags,
  temp: string,
  bins: Record<string, string>,
): TAuditReport => {
  const report = invoke(
    bins.yarn,
    ['npm', 'audit', '--all', '--json', '--recursive', ...auditFlags(flags)],
    temp,
    !!flags.silent,
    false,
    true, // `yarn npm audit` exits non-zero when vulnerabilities are found — that's a successful audit run, not a tool failure.
  )

  return parseAuditReport(report)
}

/**
 * Derive a `patched_versions` semver range from yarn 4's `Vulnerable
 * Versions` (yarn 4 dropped the explicit `patched_versions` field).
 *
 * Strategy: parse the vulnerable range, find every upper-bound comparator
 * (`<X` or `<=X`), and flip each into a lower-bound for the patched range:
 *   `<X`  → `>=X`
 *   `<=X` → `>X`
 *
 * Comparators in the same AND-set are reduced to the tightest one;
 * `||`-separated OR clauses become OR clauses in the patched output.
 *
 * Falls back to `<0.0.0` (yaf's "no fix available" sentinel — same
 * convention the legacy v2/v3 reports use) when the range has no
 * expressible upper bound.
 */
export const derivePatchedVersions = (vulnerableVersions: string): string => {
  const range = attempt(() => new sv.Range(vulnerableVersions))
  if (!range) return '<0.0.0'

  const orClauses: string[] = []
  for (const comparatorSet of range.set) {
    const upperBounds: sv.Comparator[] = comparatorSet.filter(
      (c) => c.operator === '<' || c.operator === '<=',
    )
    if (upperBounds.length === 0) return '<0.0.0' // unbounded
    const tightest = upperBounds.reduce((acc, c) =>
      sv.gt(c.semver.version, acc.semver.version) ? c : acc,
    )
    orClauses.push(
      tightest.operator === '<'
        ? `>=${tightest.semver.version}`
        : `>${tightest.semver.version}`,
    )
  }

  return orClauses.join(' || ')
}

/**
 * Parse yarn 4's NDJSON audit output. Aggregates multiple advisories for the
 * same package:
 *   - vulnerable_versions are OR-joined (`||`) — a version is vulnerable if it
 *     matches *any* advisory.
 *   - patched_versions are AND-joined (intersection, space-separated) — a fix
 *     must clear *every* advisory simultaneously. e.g. lodash advisories
 *     `>=4.17.21` ∧ `>4.17.22` ∧ `>4.17.23` collapse to `>4.17.23`.
 *
 * The AND-join can produce a floor that was never published (here `>4.17.23`
 * implies 4.17.24, which doesn't exist). Resolving that floor to a real,
 * installable version is the patch step's job — it snaps to the lowest
 * registry-published version satisfying the range (4.18.0). See `_patch` in
 * ../lockfile.ts. OR-joining patched ranges here would be wrong: it would
 * accept a version that only fixes one advisory while leaving others open.
 */
export const parseAuditReport = (data: string): TAuditReport => {
  const report: TAuditReport = {}
  for (const line of data.toString().split('\n')) {
    const entry = attempt(() => JSON.parse(line))
    const name = entry?.value
    const child = entry?.children
    const vuln = child?.['Vulnerable Versions']
    if (!name || !child || !vuln) continue

    const patched = derivePatchedVersions(vuln)
    const prev = report[name]
    report[name] = prev
      ? {
          module_name: name,
          vulnerable_versions: `${prev.vulnerable_versions} || ${vuln}`,
          patched_versions: joinAnd(prev.patched_versions, patched),
        }
      : { module_name: name, vulnerable_versions: vuln, patched_versions: patched }
  }
  return report
}

/**
 * Intersect two semver ranges. `<0.0.0` is yaf's "no fix" sentinel — if
 * either side is unfixable the intersection is too. Otherwise a plain
 * space-join expresses AND in semver range syntax.
 */
const joinAnd = (a: string, b: string): string => {
  if (a === '<0.0.0' || b === '<0.0.0') return '<0.0.0'
  return `${a} ${b}`
}
