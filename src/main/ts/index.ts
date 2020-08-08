import fs, {SymlinkType} from 'fs-extra'
import synp from 'synp'
import {join} from 'path'
import findCacheDir from 'find-cache-dir'
import chalk from 'chalk'
import {invoke, formatFlags, getSymlinkType} from './util'

type TContext = { cwd: string, temp: string, flags: Record<string, any> }

type TCallback = (cxt: TContext) => void

type TStage = [string, ...TCallback[]]

/**
 * Prepare temp assets.
 * @param {TContext} cxt
 * @return {void}
 */
const createTempAssets: TCallback = ({temp, flags}) => {
  fs.copyFileSync('yarn.lock', join(temp, 'yarn.lock'))
  fs.copyFileSync('package.json', join(temp, 'package.json'))
  fs.createSymlinkSync('node_modules', join(temp, 'node_modules'), getSymlinkType(flags.symlink) as SymlinkType) // TODO fix fs-extra typings issue
}

/**
 * Remove workspace field from package.json due to npm issue.
 * https://github.com/antongolub/yarn-audit-fix/issues/2
 * @param {TContext} cxt
 * @return {void}
 */
const fixWorkspaces: TCallback = ({temp}) => {
  const pkgJsonData = JSON.parse(fs.readFileSync(join(temp, 'package.json'), 'utf-8').trim())
  delete pkgJsonData.workspaces

  fs.writeFileSync(join(temp, 'package.json'), JSON.stringify(pkgJsonData, null, 2))
}

/**
 * Convert yarn.lock to package-lock.json for further audit.
 * @param {TContext} cxt
 * @return {void}
 */
const yarnLockToPkgLock: TCallback = ({temp}) => {
  const pgkLockJsonData = synp.yarnToNpm(temp)

  fs.writeFileSync(join(temp, 'package-lock.json'), pgkLockJsonData)
  fs.removeSync(join(temp, 'yarn.lock'))
}

/**
 * Apply npm audit fix.
 * @param {TContext} cxt
 * @return {void}
 */
const npmAuditFix: TCallback = ({temp, flags}) =>
  invoke('npm', [
    'audit', 'fix', '--package-lock-only',
    ...formatFlags(flags, 'verbose', 'loglevel', 'only', 'force', 'audit-level'),
  ], temp)

/**
 * Generate yarn.lock by package-lock.json data.
 * @param {TContext} cxt
 * @return {void}
 */
const yarnImport: TCallback = ({temp, flags}) => {
  invoke('yarn', ['import', ...formatFlags(flags, 'verbose')], temp)
  fs.copyFileSync(join(temp, 'yarn.lock'), 'yarn.lock')
}

/**
 * Apply yarn install to fetch packages after yarn.lock update.
 * @param {TContext} cxt
 * @return {void}
 */
const yarnInstall: TCallback = ({cwd, flags}) =>
  invoke('yarn', [...formatFlags(flags, 'verbose')], cwd)

/**
 * Clean up temporaries.
 * @param {TContext} cxt
 * @return {void}
 */
const clear: TCallback = ({temp}) =>
  fs.emptyDirSync(temp)

export const stages: TStage[] = [
  [
    'Preparing temp assets...',
    clear,
    createTempAssets,
    fixWorkspaces,
  ],
  [
    'Generating package-lock.json from yarn.lock...',
    yarnLockToPkgLock,
  ],
  [
    'Applying npm audit fix...',
    npmAuditFix,
  ],
  [
    'Updating yarn.lock from package-lock.json...',
    yarnImport,
    yarnInstall,
    clear,
  ],
  [
    'Done',
  ],
]

/**
 * Public static void main.
 */
export const run = async(flags: Record<string, any>) => {
  const ctx = {
    cwd: process.cwd(),
    temp: findCacheDir({name: 'yarn-audit-fix', create: true}) + '',
    flags,
  }

  for (const [description, ...steps] of stages) {
    console.log(chalk.bold(description))

    for (const step of steps) step(ctx)
  }
}
