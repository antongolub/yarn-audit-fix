import sv from 'semver'

import {
  TAuditReport,
  TFlags,
} from '../ifaces'
import { attempt, invoke } from '../util'
import { auditFlags } from './v2'

/**
 * Yarn 4+ audit. Output is NDJSON (one node per line); the explicit
 * `patched_versions` field is gone — derived from `Vulnerable Versions`.
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
    true, // audit exits non-zero when vulns found — not a failure
  )

  return parseAuditReport(report)
}

/**
 * Flip a vulnerable range into a patched one: each upper bound becomes a lower
 * bound (`<X`→`>=X`, `<=X`→`>X`), tightest per AND-set, OR-clauses preserved.
 * Returns the `<0.0.0` "no fix" sentinel when a clause has no upper bound.
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
 * Parse yarn 4 NDJSON. Per package: vulnerable ranges OR-joined (match any),
 * patched ranges AND-joined (a fix must clear all). The AND floor may be
 * unpublished (>4.17.23 → 4.17.24); _patch snaps it to a real release.
 */
export const parseAuditReport = (data: string): TAuditReport => {
  const report: TAuditReport = {}
  for (const line of data.toString().split('\n')) {
    const entry = attempt(() => JSON.parse(line))
    const name = entry?.value
    const child = entry?.children
    const vuln = child?.['Vulnerable Versions']
    if (!name || !child || !vuln) continue

    // Skip deprecations: yarn 4 reports them too, with a string ID (not a
    // numeric advisory id) and no fixable version. Out of scope for audit-fix.
    if (typeof child.ID !== 'number') continue

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

/** Intersect two ranges (space = AND); the `<0.0.0` "no fix" sentinel wins. */
const joinAnd = (a: string, b: string): string => {
  if (a === '<0.0.0' || b === '<0.0.0') return '<0.0.0'
  return `${a} ${b}`
}
