import fs, {FsSymlinkType, readFileSync} from 'fs-extra'
import cp, {StdioOptions} from 'child_process'
import chalk from 'chalk'
import minimist from 'minimist'
import {resolve} from 'path'
import glob, {Options as GlobOptions} from 'bash-glob'
import {sync as pkgDir} from 'pkg-dir'
import {sync as findUp} from 'find-up'

export const invoke = (cmd: string, args: string[], cwd: string, silent= false, inherit = true) => {
  !silent && console.log(chalk.bold('invoke'), cmd, ...args)

  const stdio: StdioOptions = inherit ? ['inherit', 'inherit', 'inherit'] : [null, null, null]
  const result = cp.spawnSync(cmd, args, {cwd, stdio})

  if (result.error || result.status) {
    throw result
  }

  return result.stdout?.toString().trim()
}

export const parseFlags = (argv: string[]) => minimist(argv, {'--': true})

const checkValue = (key: string, value: any, omitlist: any[], picklist: any[]): boolean =>
  value !== 'false' && !omitlist.includes(key) && (!picklist.length || picklist.includes(key))

const formatFlag = (key: string): string => (key.length === 1 ? '-' : '--') + key

export const formatFlags = (flags: Record<string, any>, ...picklist: string[]): string[] =>
  Object.keys(flags).reduce<string[]>((memo, key: string) => {
    const omitlist = ['_', '--']
    const value = flags[key]
    const flag = formatFlag(key)

    if (checkValue(key, value, omitlist, picklist)) {
      memo.push(flag)

      if (value !== true) {
        memo.push(value)
      }
    }

    return memo
  }, [])

export const isWindows = () => process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE as string)

export const getSymlinkType = (type?: string): FsSymlinkType =>
  type === 'junction' && isWindows()
    ? type
    : 'dir'

// https://github.com/facebook/jest/issues/2993
export const getYarn = () => isWindows() ? 'yarn.cmd' : 'yarn'

export const getClosestNpm = (cmd: string): string => {
  const pkgRoot = pkgDir(__dirname) + ''

  return findUp(dir => {
    const ref = resolve(dir, 'node_modules', '.bin', cmd)

    return fs.existsSync(ref) ? ref : undefined
  }, {cwd: pkgRoot}) + ''
}

export const getNpm = (requireNpmBeta?: boolean, allowNpmBeta?: boolean, isWin = isWindows()) => {
  const cmd = isWin ? 'npm.cmd' : 'npm'

  return requireNpmBeta && allowNpmBeta
    ? getClosestNpm(cmd)
    : cmd
}

export const getWorkspaces = (cwd: string, manifest: Record<string, any>) => {
  let packages = manifest.workspaces
  if (packages && packages.packages) {
    packages = packages.packages
  }

  if (!packages || !packages.length) {
    return []
  }

  // Turn workspaces into list of package.json files.
  return glob.sync(
    packages.map((p: string) => p.replace(/\/?$/, '/package.json')),
    {
      cwd,
      realpath: true,
      ignore: '**/node_modules/**',
    } as GlobOptions,
  )
}

export const readJson = (path: string): any =>
  JSON.parse(readFileSync(path).toString('utf-8').trim())
