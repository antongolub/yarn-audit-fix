import {
  TAuditReport,
  TFlags,
} from '../ifaces'
import { formatFlags, invoke, mapFlags } from '../util'

/**
 * Yarn 2/3 audit invocation (`yarn npm audit --all --json --recursive`).
 * Output is a single JSON object: `{advisories: {<id>: {module_name,
 * vulnerable_versions, patched_versions, …}}}`.
 *
 * Yarn 4 changed the output to NDJSON and dropped `patched_versions` —
 * that path lives in `./v4`.
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

export const parseAuditReport = (data: string): TAuditReport =>
  Object.values(JSON.parse(data).advisories).reduce<TAuditReport>(
    (m, { vulnerable_versions, module_name, patched_versions }: any) => {
      m[module_name] = {
        patched_versions,
        vulnerable_versions,
        module_name,
      }
      return m
    },
    {},
  )
