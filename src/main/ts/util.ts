import cp from 'node:child_process'
import type { StdioOptions } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import fg, { Options as GlobOptions } from 'fast-glob'

import { TFlags, TFlagsMapping } from './ifaces'

const glob = fg.sync
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// chalk.bold stand-in: SGR bold on a TTY (or FORCE_COLOR), off under NO_COLOR.
const colorize =
  !('NO_COLOR' in process.env) &&
  (!!process.stdout.isTTY || 'FORCE_COLOR' in process.env)

export const bold = (s: string): string =>
  colorize ? `\u001B[1m${s}\u001B[22m` : s

export const invoke = (
  cmd: string,
  args: string[],
  cwd: string,
  silent = false,
  inherit = true,
  skipError = false,
): string => {
  !silent && console.log(bold('invoke'), cmd, ...args)

  const stdio: StdioOptions = inherit
    ? ['inherit', 'inherit', 'inherit']
    : [null, null, null] // eslint-disable-line
  const result = cp.spawnSync(cmd, args, { cwd, stdio, shell: true })

  // `status` is null when the child was killed by a signal (e.g. Ctrl+C →
  // SIGINT), so check `signal` too — otherwise an interrupted command would be
  // mistaken for success and the run would carry on to "Done".
  if (!skipError && (result.error || result.status || result.signal)) {
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
      if (Array.isArray(value)) {
        value.forEach((val) => {
          memo.push(flag, String(val))
        })
      } else {
        memo.push(flag)
        if (value !== true) {
          memo.push(String(value))
        }
      }
    }

    return memo
  }, [])

export const mapFlags = (flags: TFlags, mapping: TFlagsMapping): TFlags =>
  Object.entries(flags).reduce<TFlags>((memo, [key, value]) => {
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
  }, {})

export const isWindows = (): boolean =>
  process.platform === 'win32' ||
  /^(msys|cygwin)$/.test(process.env.OSTYPE as string)

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
  JSON.parse(fs.readFileSync(path).toString('utf-8').trim())

export const attempt = <T>(f: () => T): T | null => {
  try {
    return f()
  } catch {
    return null // eslint-disable-line
  }
}

export const getBinVersion = (bin: string, cwd = process.cwd()): string =>
  invoke(bin, ['--version'], cwd, true, false)

export const getSelfManifest = () => readJson(findClosest('package.json') as string)

export const addHiddenProp = (obj: Record<string, any>, prop: string, value: any) =>
  Object.defineProperty(obj, prop, {
    value,
    enumerable: false
  })


const findParent = (dir: string, target: string): string | null => {
  if (fs.existsSync(path.join(dir, target))) {
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
  obj ? Object.keys(obj).sort((a: string, b: string) => a.localeCompare(b)).reduce((result, key) => {
    result[key] = obj[key]
    return result
  }, Object.create(null)) : obj
