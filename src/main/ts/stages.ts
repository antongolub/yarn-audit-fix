import fs from 'fs-extra'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import synp from 'synp'

import { TCallback } from './ifaces'
import * as lf from './lockfile'
import {
  formatFlags,
  getNpm,
  getSymlinkType,
  getWorkspaces,
  getYarn,
  invoke,
  pkgDir,
  readJson,
} from './util'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Print runtime context digest.
 */
export const printRuntimeDigest: TCallback = ({
  temp,
  cwd,
  flags,
  manifest,
}) => {
  if (flags.silent) {
    return
  }

  const isMonorepo = !!manifest.workspaces
  const npmPath = getNpm(flags['npm-path'])
  const npmVersion = invoke(npmPath, ['--version'], temp, true, false)
  const nodeVersion = invoke('node', ['--version'], temp, true, false)
  const latestYafVersion = invoke(
    npmPath,
    ['view', 'yarn-audit-fix', 'version'],
    temp,
    true,
    false,
  ) as string
  const yafVersion = readJson(
    join(pkgDir(__dirname) + '', 'package.json'), // eslint-disable-line
  ).version

  // NOTE npm > 7.0.0 provides monorepo support
  if (isMonorepo && (semver.parse(npmVersion as string)?.major as number) < 7) {
    console.warn(
      "This project looks like monorepo, so it's recommended to use `npm v7` at least to process workspaces",
    )
  }

  if (semver.gt(latestYafVersion, yafVersion)) {
    console.warn(
      `yarn-audit-fix version ${yafVersion} is out of date. Install the latest ${latestYafVersion} for better results`,
    )
  }

  console.log(
    JSON.stringify(
      {
        isMonorepo,
        npmPath,
        npmVersion,
        nodeVersion,
        yafVersion,
        temp,
        cwd,
        flags,
      },
      undefined,
      2,
    ).replace(/[",:{}]/g, ''),
  )
}

/**
 * Prepare temp assets.
 * @param {TContext} cxt
 * @return {void}
 */
export const createTempAssets: TCallback = ({ cwd, temp }) => {
  fs.copyFileSync(join(cwd, 'yarn.lock'), join(temp, 'yarn.lock'))
  fs.copyFileSync(join(cwd, 'package.json'), join(temp, 'package.json'))
  fs.existsSync(join(cwd, '.npmrc')) && fs.copyFileSync(join(cwd, '.npmrc'), join(temp, '.npmrc'))
  fs.existsSync(join(cwd, '.yarnrc')) && fs.copyFileSync(join(cwd, '.yarnrc'), join(temp, '.yarnrc'))
}

/**
 * Provide symlinks to node_modules and workspaces
 * @param {TContext} cxt
 * @return {void}
 */
export const createSymlinks: TCallback = ({ temp, flags, cwd, manifest }) => {
  const symlinkType = getSymlinkType(flags.symlink)
  const workspaces = getWorkspaces(cwd, manifest)
  const links = [
    join(cwd, 'node_modules'),
    ...workspaces.map((ws) => dirname(ws)),
  ]

  links.forEach((link: string) => {
    const rel = relative(cwd, link)
    const from = join(cwd, rel)
    const to = join(temp, rel)

    fs.createSymlinkSync(from, to, symlinkType)
  })
}

/**
 * Convert yarn.lock to package-lock.json for further audit.
 * @param {TContext} cxt
 * @return {void}
 */
export const yarnLockToPkgLock: TCallback = ({ temp, flags }) => {
  const pgkLockJsonData = synp.yarnToNpm(temp, true)

  fs.writeFileSync(join(temp, 'package-lock.json'), pgkLockJsonData)

  if (flags.flow !== 'patch') {
    fs.removeSync(join(temp, 'yarn.lock'))
  }
}

/**
 * Apply npm audit fix.
 * @param {TContext} cxt
 * @return {void}
 */
export const npmAuditFix: TCallback = ({ temp, flags }) => {
  const npm = getNpm(flags['npm-path'])
  const defaultFlags = {
    'package-lock-only': true,
  }
  const auditFlags = formatFlags(
    { ...defaultFlags, ...flags },
    'audit-level',
    'dry-run',
    'force',
    'loglevel',
    'legacy-peer-deps',
    'only',
    'package-lock-only',
    'registry',
    'silent',
    'verbose',
  )
  const auditArgs = ['audit', 'fix', ...auditFlags, '--prefix', temp]

  invoke(npm, auditArgs, temp, flags.silent)
}

/**
 * Generate yarn.lock by package-lock.json data.
 * @param {TContext} cxt
 * @return {void}
 */
export const yarnImport: TCallback = ({ temp }) => {
  const yarnLockData = synp.npmToYarn(temp, true)

  fs.writeFileSync(join(temp, 'yarn.lock'), yarnLockData)
}

export const syncLockfile: TCallback = ({ temp, flags }) => {
  if (flags.dryRun) {
    return
  }

  fs.copyFileSync(join(temp, 'yarn.lock'), 'yarn.lock')
}

/**
 * Apply yarn install to fetch packages after yarn.lock update.
 * @param {TContext} cxt
 * @return {void}
 */
export const yarnInstall: TCallback = ({ cwd, flags }) => {
  if (flags.dryRun) {
    return
  }

  invoke(
    getYarn(),
    [
      'install',
      '--update-checksums',
      ...formatFlags(flags, 'verbose', 'silent', 'registry', 'ignore-engines'),
    ],
    cwd,
    flags.silent,
  )
}
/**
 * Clean up temporaries.
 * @param {TContext} cxt
 * @return {void}
 */
export const clear: TCallback = ({ temp }) => fs.emptyDirSync(temp)

/**
 * Exit on error.
 * @param {TContext} cxt
 * @return {void}
 */
export const exit: TCallback = ({ flags, err }) => {
  !flags.silent && console.error(err)
  process.exitCode = err?.status | 0 || 1
}

export const patchLockfile: TCallback = ({ temp, ctx }) => {
  const lockfilePath = join(temp, 'yarn.lock')
  const lockfile = lf.read(lockfilePath)
  const report = lf.audit(ctx)

  lf.patch(lockfile, report, ctx)
  lf.write(lockfilePath, lockfile)
}

/**
 * Check that everything is fine with pkg dir.
 * @param {TContext} cxt
 * @return {void}
 */
export const verify: TCallback = ({ cwd }) => {
  const required = ['yarn.lock', 'package.json', 'node_modules']

  required.forEach(resource => {
    if (!fs.existsSync(join(cwd, resource))) {
      throw new Error(`not found: ${resource}`)
    }
  })
}
