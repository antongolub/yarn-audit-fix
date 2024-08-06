import type { StdioOptions } from 'node:child_process'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import path, { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

import chalk from 'chalk'
import fse, { SymlinkType } from 'fs-extra'
import fg, { Options as GlobOptions } from 'fast-glob'
import yaml from 'js-yaml'
import { reduce } from 'lodash-es'

import { TFlags, TFlagsMapping } from './ifaces'

const glob = fg.sync
// FIXME Jest workaround: cannot properly mock `child_process` with import API
const cp = createRequire(import.meta.url)('child_process')
const { ensureDirSync, readFileSync } = fse
const __dirname = dirname(fileURLToPath(import.meta.url))

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
  const result = cp.spawnSync(cmd, args, { cwd, stdio, shell: true })

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

export const getClosestBin = (cmd: string): string => findClosest(`./node_modules/.bin/${cmd}`) as string

export const getNpm = (npmPath = 'system', isWin = isWindows()): string => {
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
    } as GlobOptions,
  )
}

export const readJson = (path: string): any =>
  JSON.parse(readFileSync(path).toString('utf-8').trim())

export const ensureDir = (dir: string): string => {
  ensureDirSync(dir)

  return dir
}

export const getTemp = (cwd: string, temp?: string) =>
  temp
    ? ensureDir(resolve(cwd, temp))
    : fse.mkdtempSync(path.join(os.tmpdir(), `tempy-${crypto.randomBytes(16).toString('hex')}`))

export const attempt = <T>(f: () => T): T | null => {
  try {
    return f()
  } catch {
    return null // eslint-disable-line
  }
}

export const parseYaml = <T = Record<string, any>>(contents: string): T => {
  try {
    return yaml.load(contents) as T
  } catch (e) {
    throw new Error(`YAML required: ${e}`)
  }
}

export const formatYaml = yaml.dump

export const getBinVersion = (bin: string, cwd = process.cwd()): string =>
  invoke(bin, ['--version'], cwd, true, false)

export const getSelfManifest = () => readJson(findClosest('package.json') as string)

export const addHiddenProp = (obj: Record<string, any>, prop: string, value: any) =>
  Object.defineProperty(obj, prop, {
    value,
    enumerable: false
  })


const findParent = (dir: string, target: string): string | null => {
  if (fse.existsSync(path.join(dir, target))) {
    return dir
  }
  const parentDir = path.resolve(dir, '..')

  return dir === parentDir
    ? null
    : findParent(parentDir, target)
}

const findClosest = (target: string, cwd = __dirname): string | null => {
  const found = findParent(cwd, target)

  return found
    ? path.join(found, target)
    : null
}

export const sortObject = <T extends Record<any, any>>(obj: T): T =>
  obj ? Object.keys(obj).sort().reduce((result, key) => {
    result[key] = obj[key]
    return result
  }, Object.create(null)) : obj
