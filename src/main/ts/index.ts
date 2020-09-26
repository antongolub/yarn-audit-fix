import fs, {SymlinkType} from 'fs-extra'
import synp from 'synp'
import {join} from 'path'
import chalk from 'chalk'
import {invoke, formatFlags, getSymlinkType, getWorkspaces, getYarn, getNpm, readJson, getTemp} from './util'
import {sync as pkgDir} from 'pkg-dir'

type TContext = { cwd: string, temp: string, flags: Record<string, any>, manifest: Record<string, any>}

type TCallback = (cxt: TContext) => void | Promise<void>

type TStage = [string, ...TCallback[]]

/**
 * Print runtime context digest.
 */
const printRuntimeDigest: TCallback = ({temp, cwd, flags, manifest}) => {
  if (flags.silent) {
    return
  }

  const isMonorepo = !!manifest.workspaces
  const npmPath = getNpm(isMonorepo, flags['npm-v7'])
  const npmVersion = invoke(npmPath, ['--version'], temp, true, false)
  const nodeVersion = invoke('node', ['--version'], temp, true, false)
  const yarnAuditFixVersion = readJson(join(pkgDir(__dirname) + '', 'package.json')).version

  console.log(JSON.stringify({
    isMonorepo,
    npmPath,
    npmVersion,
    nodeVersion,
    yarnAuditFixVersion,
    temp,
    cwd,
  }, null, 2).replace(/[":,{}]/g, ''))
}

/**
 * Prepare temp assets.
 * @param {TContext} cxt
 * @return {void}
 */
const createTempAssets: TCallback = ({temp, flags}) => {
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
const createSymlinks: TCallback = ({temp, flags, cwd, manifest}) => {
  const symlinkType = getSymlinkType(flags.symlink) as SymlinkType // TODO fix fs-extra typings issue
  const workspaces = getWorkspaces(cwd, manifest)
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
const npmAuditFix: TCallback = ({temp, flags, cwd, manifest}) => {
  const requireNpmBeta = !!manifest.workspaces
  const npm = getNpm(requireNpmBeta, flags['npm-v7'], flags.silent)
  const defaultFlags = {
    'package-lock-only': true,
  }
  const auditFlags = formatFlags({...defaultFlags, ...flags},
'package-lock-only',
    'verbose',
    'loglevel',
    'only',
    'force',
    'audit-level',
    'silent',
    'registry',
  )
  const auditArgs = [
    'audit',
    'fix',
    ...auditFlags,
    '--prefix', temp,
  ]

  invoke(npm, auditArgs, temp, flags.silent)
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
  invoke(getYarn(), ['--update-checksums', ...formatFlags(flags, 'verbose', 'silent', 'registry')], cwd, flags.silent)
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
    'Runtime digest',
    printRuntimeDigest,
  ],
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
  const cwd = process.cwd()
  const manifest = readJson(join(cwd, 'package.json'))
  const temp = getTemp(cwd, flags.temp)
  const ctx = {
    cwd,
    temp,
    flags,
    manifest,
  }

  for (const [description, ...steps] of stages) {
    !flags.silent && console.log(chalk.bold(description))

    for (const step of steps) step(ctx)
  }
}
