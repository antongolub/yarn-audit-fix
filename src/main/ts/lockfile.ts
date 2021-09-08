import lf from '@yarnpkg/lockfile'
import { SpawnSyncReturns } from 'child_process'
import fs from 'fs-extra'
import { keyBy } from 'lodash-es'
import sv from 'semver'

import { TAuditEntry, TAuditReport, TContext, TLockfileObject } from './ifaces'
import { attempt, formatFlags, getNpm, getYarn, invoke, mapFlags } from './util'

export const _read = (name: string): TLockfileObject => {
  const data = lf.parse(fs.readFileSync(name, 'utf-8'))

  if (data.type !== 'success') {
    throw new Error('Merge conflict in yarn lockfile, aborting')
  }

  return data.object
}

export const _write = (name: string, lockfile: TLockfileObject): void => {
  fs.writeFileSync(name, lf.stringify(lockfile))
}

/**
 * Pulled up from https://github.com/hfour/yarn-audit-fix-ng/blob/main/src/index.ts
 */
export const _patch = (
  lockfile: TLockfileObject,
  report: TAuditReport,
  { flags }: TContext,
): TLockfileObject => {
  if (Object.keys(report).length === 0) {
    !flags.silent && console.log('Audit check found no issues')
    return lockfile
  }

  const upgraded: string[] = []

  for (const depSpec of Object.keys(lockfile)) {
    const [pkgName, desiredRange] = depSpec.split('@')
    const pkgAudit = report[pkgName]
    if (!pkgAudit) continue
    const pkgSpec = lockfile[depSpec]
    if (sv.satisfies(pkgSpec.version, pkgAudit.vulnerable_versions)) {
      const fix = sv.minVersion(pkgAudit.patched_versions)?.format()
      if (fix === undefined) {
        console.error(
          "Can't find satisfactory version for",
          pkgAudit.module_name,
          pkgAudit.patched_versions,
        )
        continue
      }
      if (!sv.satisfies(fix, desiredRange) && !flags.force) {
        console.error(
          "Can't find patched version that satisfies",
          depSpec,
          'in',
          pkgAudit.patched_versions,
        )
        continue
      }
      upgraded.push(`${pkgName}@${fix}`)
      pkgSpec.version = fix
      pkgSpec.dependencies = []
      pkgSpec.integrity = ''
      pkgSpec.resolved = ''
    }
  }

  !flags.silent &&
    console.log(
      'Upgraded deps:',
      upgraded.length > 0 ? upgraded.join(', ') : '<none>',
    )

  return lockfile
}

export const _audit = ({ flags, temp }: TContext): TAuditReport => {
  const cmd = flags.reporter === 'npm' ? getNpm(flags['npm-path']) : getYarn()
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
    true,
  )

  return _parseAuditJsonReport(report)
}

export const _parseAuditJsonReport = (
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

// FIXME Jest cannot mock esm yet
// https://github.com/facebook/jest/commit/90d6908492d164392ce8429923e7f0fa17946d2d
export const _internal = {
  _read,
  _audit,
  _patch,
  _parseAuditJsonReport,
  _write,
}

export const read: typeof _read = (...args) => _internal._read(...args)
export const audit: typeof _audit = (...args) => _internal._audit(...args)
export const patch: typeof _patch = (...args) => _internal._patch(...args)
export const write: typeof _write = (...args) => _internal._write(...args)
export const parseAuditJsonReport: typeof _parseAuditJsonReport = (...args) =>
  _internal._parseAuditJsonReport(...args)
