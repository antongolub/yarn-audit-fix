import {
  TAuditReport,
  TFlags,
  TRawAdvisory,
} from '../ifaces'
import { formatFlags, invoke, mapFlags } from '../util'
import { extractRefs, mergeMeta } from './meta'

/**
 * Yarn 2/3 audit. Output is one JSON object `{advisories: {<id>: …}}`.
 * Yarn 4 switched to NDJSON — that path lives in `./v4`.
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

export const auditFlags = (flags: TFlags): string[] => {
  const mapping = {
    'audit-level': 'severity',
    level: 'severity',
    groups: {
      key: 'environment',
      values: {
        dependencies: 'production',
      },
    },
    only: {
      key: 'environment',
      values: {
        prod: 'production',
      },
    },
  }
  return formatFlags(
    mapFlags(flags, mapping),
    'exclude',
    'ignore',
    'groups',
    'verbose',
  )
}

export const parseAuditReport = (data: string): TAuditReport => {
  const advisories = JSON.parse(data).advisories as Record<string, TRawAdvisory>
  const report: TAuditReport = {}
  for (const a of Object.values(advisories)) {
    const entry = {
      module_name: a.module_name,
      vulnerable_versions: a.vulnerable_versions,
      patched_versions: a.patched_versions,
      severity: a.severity,
      // npm ships score 0 (vectorString null) as "unscored" — treat as absent.
      cvss: a.cvss?.score || undefined,
      refs: extractRefs(a.cves, a.url, a.references, a.title),
      url: a.url,
    }
    const prev = report[entry.module_name]
    report[entry.module_name] = prev
      ? { ...entry, ...mergeMeta(prev, entry) }
      : entry
  }
  return report
}
