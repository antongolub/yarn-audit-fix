import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import fg, { Options as GlobOptions } from 'fast-glob'

import { TFlags } from './ifaces'

const glob = fg.sync
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// chalk.bold stand-in: SGR bold on a TTY (or FORCE_COLOR), off under NO_COLOR.
const colorize =
  !('NO_COLOR' in process.env) &&
  (!!process.stdout.isTTY || 'FORCE_COLOR' in process.env)

export const bold = (s: string): string =>
  colorize ? `\u001B[1m${s}\u001B[22m` : s

// https://gist.github.com/nblackburn/875e6ff75bc8ce171c758bf75f304707
const camelToKebab = (string: string): string =>
  string.replace(/([\da-z]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()

export const normalizeFlags = (flags: TFlags): TFlags =>
  Object.keys(flags).reduce<TFlags>((m, key) => {
    m[camelToKebab(key)] = flags[key]
    return m
  }, {})

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

export const getSelfManifest = () => readJson(findClosest('package.json') as string)

const findParent = (dir: string, target: string): string | null => {
  if (fs.existsSync(path.join(dir, target))) {
    return dir
  }
  const parentDir = path.resolve(dir, '..')

  return dir === parentDir ? null : findParent(parentDir, target)
}

const findClosest = (target: string, cwd = __dirname): string | null => {
  const found = findParent(cwd, target)

  return found ? path.join(found, target) : null
}
