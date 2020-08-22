import fs, {SymlinkType} from 'fs-extra'
import synp from 'synp'
import {join} from 'path'
import findCacheDir from 'find-cache-dir'
import chalk from 'chalk'
import {invoke, formatFlags, getSymlinkType, getWorkspaces, getYarn, getNpm} from './util'

type TContext = { cwd: string, temp: string, flags: Record<string, any> }

type TCallback = (cxt: TContext) => void | Promise<void>

type TStage = [string, ...TCallback[]]

/**
 * Prepare temp assets.
 * @param {TContext} cxt
 * @return {void}
 */
const createTempAssets: TCallback = ({temp, flags}) => {
  fs.copyFileSync('yarn.lock', join(temp, 'yarn.lock'))
  fs.copyFileSync('package.json', join(temp, 'package.json'))
}

/**
 * Provide symlinks to node_modules and workspaces
 * @param {TContext} cxt
 * @return {void}
 */
const createSymlinks: TCallback = ({temp, flags, cwd}) => {
  const symlinkType = getSymlinkType(flags.symlink) as SymlinkType // TODO fix fs-extra typings issue
  const workspaces = getWorkspaces(cwd)
  const links = [join(cwd, 'node_modules'), ...workspaces]

  links.forEach((pkgPath: string) => {
    const rel = pkgPath.replace(/\/package\.json$/, '').slice(cwd.length)
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
const yarnLockToPkgLock: TCallback = ({temp}) => {
  const pgkLockJsonData = synp.yarnToNpm(temp, true)

  fs.writeFileSync(join(temp, 'package-lock.json'), pgkLockJsonData)
  fs.removeSync(join(temp, 'yarn.lock'))
}

/**
 * Apply npm audit fix.
 * @param {TContext} cxt
 * @return {void}
 */
const npmAuditFix: TCallback = ({temp, flags}) => {
  const auditArgs = [
    'audit',
    'fix',
    ...formatFlags(flags, 'package-lock-only', 'verbose', 'loglevel', 'only', 'force', 'audit-level', 'silent'),
  ]

  invoke(getNpm(), [...auditArgs, `--prefix=${temp}`], temp, flags.silent)
}

/**
 * Generate yarn.lock by package-lock.json data.
 * @param {TContext} cxt
 * @return {void}
 */
const yarnImport: TCallback = ({temp, flags}) => {
  const yarnLockData = synp.npmToYarn(temp, true)

  fs.writeFileSync(join(temp, 'yarn.lock'), yarnLockData)
  fs.copyFileSync(join(temp, 'yarn.lock'), 'yarn.lock')
}

/**
 * Apply yarn install to fetch packages after yarn.lock update.
 * @param {TContext} cxt
 * @return {void}
 */
const yarnInstall: TCallback = ({cwd, flags}) => {
  invoke(getYarn(), ['--update-checksums', ...formatFlags(flags, 'verbose', 'silent')], cwd, flags.silent)
}
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
    createSymlinks,
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
export const run = async(flags: Record<string, any> = {}) => {
  const ctx = {
    cwd: process.cwd(),
    temp: findCacheDir({name: 'yarn-audit-fix', create: true}) + '',
    flags,
  }

  for (const [description, ...steps] of stages) {
    !flags.silent && console.log(chalk.bold(description))

    for (const step of steps) step(ctx)
  }
}
