import { TAuditEntry, TAuditReport } from '../ifaces'
import { attempt } from '../util'
import { extractRefs, mergeMeta } from './meta'

/**
 * Parse npm / yarn-classic `audit --json` output (one `{data:{advisory}}` event
 * per line). The runtime now fetches advisories straight from the registry
 * (see `audit/registry`); this parser is retained for the `lockfile` patch tests.
 */
export const parseAuditReport = (data: string): TAuditReport => {
  const report: TAuditReport = {}
  for (const line of data.split('\n')) {
    const a = (attempt(() => JSON.parse(line)) as TAuditEntry)?.data?.advisory
    if (!a) continue

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
    // Ranges keep last-wins (legacy keyBy behaviour); metadata aggregates.
    report[entry.module_name] = prev
      ? { ...entry, ...mergeMeta(prev, entry) }
      : entry
  }
  return report
}
