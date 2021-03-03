import fs from 'fs-extra'
import { dirname, join, relative } from 'path'
import { sync as pkgDir } from 'pkg-dir'
import synp from 'synp'

import { TCallback } from './ifaces'
import {
  formatFlags,
  getNpm,
  getSymlinkType,
  getWorkspaces,
  getYarn,
  invoke,
  readJson,
} from './util'

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
  const npmPath = getNpm(isMonorepo, flags['npm-v7'])
  const npmVersion = invoke(npmPath, ['--version'], temp, true, false)
  const nodeVersion = invoke('node', ['--version'], temp, true, false)
  const yarnAuditFixVersion = readJson(
    join(pkgDir(__dirname) + '', 'package.json'), // eslint-disable-line
  ).version

  console.log(
    JSON.stringify(
      {
        isMonorepo,
        npmPath,
        npmVersion,
        nodeVersion,
        yarnAuditFixVersion,
        temp,
        cwd,
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
export const createTempAssets: TCallback = ({ temp }) => {
  fs.copyFileSync('yarn.lock', join(temp, 'yarn.lock'))
  fs.copyFileSync('package.json', join(temp, 'package.json'))
  fs.existsSync('.npmrc') && fs.copyFileSync('.npmrc', join(temp, '.npmrc'))
  fs.existsSync('.yarnrc') && fs.copyFileSync('.yarnrc', join(temp, '.yarnrc'))
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
export const yarnLockToPkgLock: TCallback = ({ temp }) => {
  const pgkLockJsonData = synp.yarnToNpm(temp, true)

  fs.writeFileSync(join(temp, 'package-lock.json'), pgkLockJsonData)
  fs.removeSync(join(temp, 'yarn.lock'))
}

/**
 * Apply npm audit fix.
 * @param {TContext} cxt
 * @return {void}
 */
export const npmAuditFix: TCallback = ({ temp, flags, manifest }) => {
  const requireNpmBeta = !!manifest.workspaces
  const npm = getNpm(requireNpmBeta, flags['npm-v7'], flags.silent)
  const defaultFlags = {
    'package-lock-only': true,
  }
  const auditFlags = formatFlags(
    { ...defaultFlags, ...flags },
    'package-lock-only',
    'verbose',
    'loglevel',
    'only',
    'force',
    'audit-level',
    'silent',
    'registry',
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
  fs.copyFileSync(join(temp, 'yarn.lock'), 'yarn.lock')
}

/**
 * Apply yarn install to fetch packages after yarn.lock update.
 * @param {TContext} cxt
 * @return {void}
 */
export const yarnInstall: TCallback = ({ cwd, flags }) => {
  invoke(
    getYarn(),
    [
      '--update-checksums',
      ...formatFlags(flags, 'verbose', 'silent', 'registry'),
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
