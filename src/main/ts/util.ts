import cp from 'child_process'
import chalk from 'chalk'
import {FsSymlinkType, readFileSync} from 'fs-extra'
import minimist from 'minimist'
import {join} from 'path'
import {sync as pkgDir} from 'pkg-dir'
import glob, {Options as GlobOptions} from 'bash-glob'

export const invoke = (cmd: string, args: string[], cwd: string, silent= false) => {
  !silent && console.log(chalk.bold('invoke'), cmd, ...args)

  const result = cp.spawnSync(cmd, args, {cwd, stdio: ['inherit', 'inherit', 'inherit']})

  if (result.error || result.status) {
    throw result
  }
}

export const parseFlags = (argv: string[]) => minimist(argv, {'--': true})

const checkByLists = (value: any, omitlist: any[], picklist: any[]): boolean =>
  !omitlist.includes(value) && (!picklist.length || picklist.includes(value))

const formatFlag = (key: string): string => (key.length === 1 ? '-' : '--') + key

export const formatFlags = (flags: Record<string, any>, ...picklist: string[]): string[] =>
  Object.keys(flags).reduce<string[]>((memo, key: string) => {
    const omitlist = ['_', '--']
    const value = flags[key]
    const flag = formatFlag(key)

    if (checkByLists(key, omitlist, picklist)) {
      memo.push(flag)

      if (value !== true) {
        memo.push(value)
      }
    }

    return memo
  }, [])

const isWindows = () => process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE as string)

export const getSymlinkType = (type?: string): FsSymlinkType =>
  type === 'junction' && isWindows()
    ? type
    : 'dir'

export const getNpmBin = () => join(pkgDir(__dirname) as string, 'node_modules/.bin/npm')

export const getWorkspaces = (cwd: string) => {
  const manifest = readJson(join(cwd, 'package.json'))

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
