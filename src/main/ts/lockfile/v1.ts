import { SpawnSyncReturns } from 'node:child_process'

import lf from '@yarnpkg/lockfile'
import { keyBy } from 'lodash-es'

import {
  TAuditEntry,
  TAuditReport,
  TFlags,
  TLockfileEntry,
  TLockfileObject,
} from '../ifaces'
import { attempt, formatFlags, invoke, mapFlags } from '../util'

export const parse = (raw: string): TLockfileObject => {
  const data = lf.parse(raw)

  if (data.type !== 'success') {
    throw new Error('Merge conflict in yarn lockfile, aborting')
  }

  return data.object
}

export const patchEntry = (
  entry: TLockfileEntry,
  name: string,
  newVersion: string,
): TLockfileEntry => {
  entry.version = newVersion
  entry.dependencies = {}
  entry.integrity = ''
  entry.resolved = ''

  return entry
}

export const format = (lockfile: TLockfileObject): string =>
  lf.stringify(lockfile)

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
