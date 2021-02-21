import chalk from 'chalk'
import cp, { StdioOptions } from 'child_process'
import crypto from 'crypto'
import findCacheDir from 'find-cache-dir'
import { sync as findUp } from 'find-up'
import fs, { ensureDirSync, readFileSync, SymlinkType } from 'fs-extra'
import { GlobbyOptions } from 'globby'
import minimist from 'minimist'
import { join, resolve } from 'path'
import { sync as pkgDir } from 'pkg-dir'

import { glob } from './glob'

export const invoke = (
  cmd: string,
  args: string[],
  cwd: string,
  silent = false,
  inherit = true,
): string | ReturnType<typeof cp.spawnSync> => {
  !silent && console.log(chalk.bold('invoke'), cmd, ...args)

  const stdio: StdioOptions = inherit
    ? ['inherit', 'inherit', 'inherit']
    : [null, null, null] // eslint-disable-line
  const result = cp.spawnSync(cmd, args, { cwd, stdio })

  if (result.error || result.status) {
    throw result
  }

  return '' + result.stdout?.toString().trim()
}

export const parseFlags = (argv: string[]): ReturnType<typeof minimist> =>
  minimist(argv, { '--': true })

const checkValue = (
  key: string,
  value: any,
  omitlist: any[],
  picklist: any[],
): boolean =>
  value !== 'false' &&
  !omitlist.includes(key) &&
  (picklist.length === 0 || picklist.includes(key))

const formatFlag = (key: string): string =>
  (key.length === 1 ? '-' : '--') + key

export const formatFlags = (
  flags: Record<string, any>,
  ...picklist: string[]
): string[] =>
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

export const isWindows = (): boolean =>
  process.platform === 'win32' ||
  /^(msys|cygwin)$/.test(process.env.OSTYPE as string)

export const getSymlinkType = (type?: string): SymlinkType =>
  type === 'junction' && isWindows() ? type : 'dir'

// https://github.com/facebook/jest/issues/2993
export const getYarn = (): string => (isWindows() ? 'yarn.cmd' : 'yarn')

export const getClosestNpm = (cmd: string): string => {
  const pkgRoot = pkgDir(__dirname) + ''

  return (
    findUp(
      (dir) => {
        const ref = resolve(dir, 'node_modules', '.bin', cmd)

        return fs.existsSync(ref) ? ref : undefined
      },
      { cwd: pkgRoot },
    ) + ''
  )
}

export const getNpm = (
  requireNpmBeta?: boolean,
  allowNpmBeta?: boolean,
  silent = false,
  isWin = isWindows(),
): string => {
  const cmd = isWin ? 'npm.cmd' : 'npm'

  if (requireNpmBeta && !allowNpmBeta && !silent) {
    console.warn(
      'The project looks like monorepo, so it is recommended to use `--npm-v7` flag',
    )
  }

  return allowNpmBeta ? getClosestNpm(cmd) : cmd
}

export const getWorkspaces = (
  cwd: string,
  manifest: Record<string, any>,
): string[] => {
  let packages = manifest.workspaces
  if (packages && packages.packages) {
    packages = packages.packages
  }

  if (!packages || packages.length === 0) {
    return []
  }

  // Turn workspaces into list of package.json files.
  return glob(
    packages.map((p: string) => p.replace(/\/?$/, '/package.json')),
    {
      cwd,
      onlyFiles: true,
      absolute: true,
      gitignore: true,
    } as GlobbyOptions,
  )
}

export const readJson = (path: string): any =>
  JSON.parse(readFileSync(path).toString('utf-8').trim())

export const ensureDir = (dir: string): string => {
  ensureDirSync(dir)

  return dir
}

export const getTemp = (cwd: string, temp?: string): string => {
  if (temp) {
    return ensureDir(resolve(temp))
  }

  const id = crypto.randomBytes(16).toString('hex')
  const cacheDir = findCacheDir({ name: 'yarn-audit-fix', cwd }) + ''
  const tempDir = join(cacheDir, id)

  return ensureDir(tempDir)
}
