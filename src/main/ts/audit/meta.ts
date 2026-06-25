import sv from 'semver'

import { TAuditAdvisory } from '../ifaces'
import { attempt } from '../util'

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
}

/** Higher severity wins; unknown labels rank lowest. */
export const maxSeverity = (a?: string, b?: string): string | undefined => {
  if (a === undefined) return b
  if (b === undefined) return a
  return (SEVERITY_RANK[b] ?? -1) > (SEVERITY_RANK[a] ?? -1) ? b : a
}

const CVE = /CVE-\d{4}-\d{4,}/g
const GHSA = /GHSA-[\da-z]{4}-[\da-z]{4}-[\da-z]{4}/gi

/** Collect CVE / GHSA identifiers from explicit `cves` plus free-text fields. */
export const extractRefs = (
  cves: string[] | undefined,
  ...text: (string | undefined)[]
): string[] => {
  const refs = new Set<string>()
  for (const c of cves ?? []) if (c) refs.add(c)
  const blob = text.filter(Boolean).join(' ')
  for (const m of blob.matchAll(CVE)) refs.add(m[0])
  for (const m of blob.matchAll(GHSA)) refs.add(m[0])
  return [...refs]
}

/** Merge advisory *metadata* (severity, score, refs) — not version ranges. */
export const mergeMeta = (
  prev: TAuditAdvisory,
  next: TAuditAdvisory,
): Pick<TAuditAdvisory, 'severity' | 'cvss' | 'refs' | 'url'> => {
  const cvss = Math.max(prev.cvss ?? -1, next.cvss ?? -1)
  return {
    severity: maxSeverity(prev.severity, next.severity),
    cvss: cvss >= 0 ? cvss : undefined,
    refs: [...new Set([...(prev.refs ?? []), ...(next.refs ?? [])])],
    url: prev.url ?? next.url,
  }
}

/**
 * Render advisory metadata for the upgrade summary, e.g.
 *   `  [high, CVSS 7.5] CVE-2021-23337`
 * Returns '' when nothing is known.
 */
export const formatAdvisoryMeta = (a?: TAuditAdvisory): string => {
  if (!a) return ''
  const badge: string[] = []
  if (a.severity) badge.push(a.severity)
  // npm ships score 0 (vectorString null) as "unscored", not a real 0.0 — drop
  // it so we never print a contradictory "[critical, CVSS 0]".
  if (a.cvss) badge.push(`CVSS ${a.cvss}`)

  const parts: string[] = []
  if (badge.length > 0) parts.push(`[${badge.join(', ')}]`)
  if (a.refs && a.refs.length > 0) parts.push(a.refs.join(', '))

  return parts.length > 0 ? `  ${parts.join(' ')}` : ''
}

/**
 * Flip a vulnerable range into a patched one: each upper bound becomes a lower
 * bound (`<X`→`>=X`, `<=X`→`>X`), tightest per AND-set, OR-clauses preserved.
 * Returns the `<0.0.0` "no fix" sentinel when a clause has no upper bound.
 * The registry advisory feed gives vulnerable ranges only; this derives the fix.
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
