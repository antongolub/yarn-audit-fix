import { TAuditReport, TRawAdvisory } from '../ifaces'
import { extractRefs, mergeMeta } from './meta'

/**
 * Parse Yarn 2/3 `npm audit --json` output — one JSON object
 * `{advisories: {<id>: …}}`. Yarn 4 switched to NDJSON (see `./v4`). The runtime
 * now fetches advisories straight from the registry (see `audit/registry`);
 * this parser is retained for the `lockfile` patch tests.
 */
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
