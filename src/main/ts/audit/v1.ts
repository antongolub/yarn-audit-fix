import { SpawnSyncReturns } from 'node:child_process'

import { keyBy } from 'lodash-es'

import {
  TAuditEntry,
  TAuditReport,
  TFlags,
} from '../ifaces'
import { attempt, formatFlags, invoke, mapFlags } from '../util'

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
): TAuditReport =>
  keyBy(
    data
      .toString()
      .split('\n')
      .map((item) => attempt(() => JSON.parse(item)) as TAuditEntry)
      .map((item) => item?.data?.advisory)
      .filter((item) => item !== undefined)
      .map((item) => ({
        module_name: item.module_name,
        vulnerable_versions: item.vulnerable_versions,
        patched_versions: item.patched_versions,
      })),
    (item) => item.module_name,
  )
