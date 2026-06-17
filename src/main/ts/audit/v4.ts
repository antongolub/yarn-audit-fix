import sv from 'semver'

import { TAuditReport } from '../ifaces'
import { attempt } from '../util'
import { extractRefs, mergeMeta } from './meta'

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
  for (const line of data.split('\n')) {
    const node = attempt(() => JSON.parse(line))
    const name = node?.value
    const child = node?.children
    const vuln = child?.['Vulnerable Versions']
    if (!name || !child || !vuln) continue

    // Skip deprecations: yarn 4 reports them too, with a string ID (not a
    // numeric advisory id) and no fixable version. Out of scope for audit-fix.
    if (typeof child.ID !== 'number') continue

    const entry = {
      module_name: name,
      vulnerable_versions: vuln,
      patched_versions: derivePatchedVersions(vuln),
      severity: child.Severity,
      refs: extractRefs(undefined, child.URL, child.Issue),
      url: child.URL,
    }
    const prev = report[name]
    report[name] = prev
      ? {
          ...entry,
          ...mergeMeta(prev, entry),
          vulnerable_versions: `${prev.vulnerable_versions} || ${vuln}`,
          patched_versions: joinAnd(prev.patched_versions, entry.patched_versions),
        }
      : entry
  }
  return report
}

/** Intersect two ranges (space = AND); the `<0.0.0` "no fix" sentinel wins. */
const joinAnd = (a: string, b: string): string => {
  if (a === '<0.0.0' || b === '<0.0.0') return '<0.0.0'
  return `${a} ${b}`
}
