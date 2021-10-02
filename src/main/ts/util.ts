import chalk from 'chalk'
import crypto from 'crypto'
import findCacheDir from 'find-cache-dir'
import { findUpSync, pathExistsSync } from 'find-up'
import fse, { SymlinkType } from 'fs-extra'
import { globbySync as glob, Options as GlobbyOptions } from 'globby'
import { reduce } from 'lodash-es'
import type { StdioOptions } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageDirectorySync } from 'pkg-dir'

import { TFlags, TFlagsMapping } from './ifaces'

// FIXME Jest workaround: cannot properly mock `child_process` with import API
const cp = createRequire(import.meta.url)('child_process')
const { ensureDirSync, readFileSync } = fse
const __dirname = dirname(fileURLToPath(import.meta.url))

export const pkgDir = (cwd: string): string => packageDirectorySync({cwd})

export const invoke = (
  cmd: string,
  args: string[],
  cwd: string,
  silent = false,
  inherit = true,
  skipError = false,
): string | ReturnType<typeof cp.spawnSync> => {
  !silent && console.log(chalk.bold('invoke'), cmd, ...args)

  const stdio: StdioOptions = inherit
    ? ['inherit', 'inherit', 'inherit']
    : [null, null, null] // eslint-disable-line
  const result = cp.spawnSync(cmd, args, { cwd, stdio })

  if (!skipError && (result.error || result.status)) {
    throw result
  }

  return String(result.stdout?.toString().trim())
}

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

// https://gist.github.com/nblackburn/875e6ff75bc8ce171c758bf75f304707
const camelToKebab = (string: string): string =>
  string.replace(/([\da-z]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()

export const normalizeFlags = (flags: TFlags): TFlags =>
  Object.keys(flags).reduce<TFlags>((m, key) => {
    m[camelToKebab(key)] = flags[key]
    return m
  }, {})

export const formatFlags = (flags: TFlags, ...picklist: string[]): string[] =>
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

export const mapFlags = (flags: TFlags, mapping: TFlagsMapping): TFlags =>
  reduce(
    flags,
    (memo: TFlags, value: any, key: string) => {
      const repl = mapping[key]
      let k = key
      let v = value

      if (repl) {
        if (typeof repl === 'string') {
          k = repl
        } else {
          k = repl?.key ?? k
          v = repl?.value ?? repl?.values?.[value] ?? v
        }
      }

      memo[k] = v

      return memo
    },
    {},
  )

export const isWindows = (): boolean =>
  process.platform === 'win32' ||
  /^(msys|cygwin)$/.test(process.env.OSTYPE as string)

export const getSymlinkType = (type?: string): SymlinkType =>
  (type as SymlinkType) || (isWindows() ? 'junction' : 'dir')

// https://github.com/facebook/jest/issues/2993
export const getYarn = (): string => (isWindows() ? 'yarn.cmd' : 'yarn')

export const getClosestBin = (cmd: string): string =>
  String(
    findUpSync(
      (dir) => {
        const ref = resolve(dir, 'node_modules', '.bin', cmd)

        return pathExistsSync(ref) ? ref : undefined
      },
      {
        cwd: String(pkgDir(__dirname)),
      },
    ),
  )

export const getNpm = (npmPath = 'local', isWin = isWindows()): string => {
  const cmd = isWin ? 'npm.cmd' : 'npm'

  if (npmPath === 'system') {
    return cmd
  }

  if (npmPath === 'local') {
    return getClosestBin(cmd)
  }

  return npmPath
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

export const attempt = <T>(f: () => T): T | null => {
  try {
    return f()
  } catch {
    return null // eslint-disable-line
  }
}
