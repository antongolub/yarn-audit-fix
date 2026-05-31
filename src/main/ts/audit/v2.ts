import {
  TAuditAdvisory,
  TAuditReport,
  TFlags,
} from '../ifaces'
import { formatFlags, invoke, mapFlags } from '../util'

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
  const advisories = JSON.parse(data).advisories as Record<string, TAuditAdvisory>
  return Object.values(advisories).reduce<TAuditReport>(
    (m, { vulnerable_versions, module_name, patched_versions }) => {
      m[module_name] = { module_name, vulnerable_versions, patched_versions }
      return m
    },
    {},
  )
}
