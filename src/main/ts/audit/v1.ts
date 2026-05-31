import { SpawnSyncReturns } from 'node:child_process'

import {
  TAuditEntry,
  TAuditReport,
  TFlags,
} from '../ifaces'
import { attempt, formatFlags, invoke, mapFlags } from '../util'
import { extractRefs, mergeMeta } from './meta'

/**
 * npm / yarn-classic audit. Produces a stream of `auditAdvisory` events
 * (one JSON object per line).
 */
export const audit = (
  flags: TFlags,
  temp: string,
  bins: Record<string, string>,
): TAuditReport => {
  const cmd = flags.reporter === 'npm' ? bins.npm : bins.yarn
  const mapping = {
    'audit-level': 'level',
    only: {
      key: 'groups',
      values: {
        prod: 'dependencies',
        dev: 'devDependencies',
      },
    },
  }
  const _flags = formatFlags(
    mapFlags(flags, mapping),
    'groups',
    'verbose',
    'level',
  )
  const report = invoke(
    cmd,
    ['audit', '--json', ..._flags],
    temp,
    !!flags.silent,
    false,
    true, // NOTE skipping error here is correct: status means the highest found severity level, not call rejection as usual.
  )

  return parseAuditReport(report)
}

export const parseAuditReport = (
  data: string | SpawnSyncReturns<Buffer>,
): TAuditReport => {
  const report: TAuditReport = {}
  for (const line of data.toString().split('\n')) {
    const a = (attempt(() => JSON.parse(line)) as TAuditEntry)?.data?.advisory
    if (!a) continue

    const entry = {
      module_name: a.module_name,
      vulnerable_versions: a.vulnerable_versions,
      patched_versions: a.patched_versions,
      severity: a.severity,
      cvss: typeof a.cvss?.score === 'number' ? a.cvss.score : undefined,
      refs: extractRefs(a.cves, a.url, a.references, a.title),
      url: a.url,
    }
    const prev = report[entry.module_name]
    // Ranges keep last-wins (legacy keyBy behaviour); metadata aggregates.
    report[entry.module_name] = prev
      ? { ...entry, ...mergeMeta(prev, entry) }
      : entry
  }
  return report
}
