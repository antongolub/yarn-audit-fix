import sv from 'semver'

import {
  TAuditReport,
  TContext, TFlags,
  TLockfileObject,
  TLockfileType
} from './ifaces'

import {
  audit as auditV1,
  parse as parseV1,
  format as formatV1
} from './lockfile-v1'

import {
  audit as auditV2,
  parse as parseV2,
  format as formatV2
} from './lockfile-v2'

export const getLockfileType = (lockfile: string): TLockfileType => {
  if (lockfile.match(/yarn lockfile v1/)) {
    return 'yarn1'
  }

  if (lockfile.match(/__metadata/)) {
    return 'yarn2'
  }

  return null
}

export const _parse = (lockfile: string, lockfileType : TLockfileType): TLockfileObject => {
  if (lockfileType === null) {
    throw new Error('Unsupported lockfile format')
  }

  return lockfileType === 'yarn2'
    ? parseV2(lockfile)
    : parseV1(lockfile)
}

export const _format = (lockfile: TLockfileObject, lockfileType: TLockfileType): string =>
  lockfileType === 'yarn2'
    ? formatV2(lockfile)
    : formatV1(lockfile)

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
      pkgSpec.dependencies = {}
      pkgSpec.integrity = ''
      pkgSpec.resolved = ''

      // v2
      // pkgSpec.resolution = `${pkgName}@npm:${fix}`
      // delete pkgSpec.checksum
    }
  }

  !flags.silent &&
    console.log(
      'Upgraded deps:',
      upgraded.length > 0 ? upgraded.join(', ') : '<none>',
    )

  return lockfile
}

export const _audit = (flags: TFlags, temp: string, lockfileType: TLockfileType): TAuditReport =>
  lockfileType === 'yarn2'
    ? auditV2(flags, temp)
    : auditV1(flags, temp)

// FIXME Jest cannot mock esm yet
// https://github.com/facebook/jest/commit/90d6908492d164392ce8429923e7f0fa17946d2d
export const _internal = {
  _parse,
  _audit,
  _patch,
  _format,
}

export const parse: typeof _parse = (...args) => _internal._parse(...args)
export const audit: typeof _audit = (...args) => _internal._audit(...args)
export const patch: typeof _patch = (...args) => _internal._patch(...args)
export const format: typeof _format = (...args) => _internal._format(...args)
