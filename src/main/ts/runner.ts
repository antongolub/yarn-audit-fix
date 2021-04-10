import chalk from 'chalk'
import { join } from 'path'

import { TCallback, TContext, TFlags, TStage } from './ifaces'
import {
  clear,
  createSymlinks,
  createTempAssets,
  exit,
  npmAuditFix,
  printRuntimeDigest,
  yarnImport,
  yarnInstall,
  yarnLockToPkgLock,
} from './stages'
import { getTemp, normalizeFlags, readJson } from './util'

export const main: TStage[] = [
  ['Runtime digest', printRuntimeDigest],
  ['Preparing temp assets...', clear, createTempAssets, createSymlinks],
  ['Generating package-lock.json from yarn.lock...', yarnLockToPkgLock],
  ['Applying npm audit fix...', npmAuditFix],
  [
    'Updating yarn.lock from package-lock.json...',
    yarnImport,
    yarnInstall,
    clear,
  ],
  ['Done'],
]

export const fallback: TStage[] = [['Failure!', clear, exit]]

/**
 * Build running context.
 */
export const getContext = (flags: Record<string, any> = {}): TContext => {
  const cwd = process.cwd()
  const manifest = readJson(join(cwd, 'package.json'))
  const temp = getTemp(cwd, flags.temp)

  return {
    cwd,
    temp,
    flags,
    manifest,
  }
}

/**
 * Run cmd stack.
 * @param stages
 * @param ctx
 */
export const exec = (stages: TStage[], ctx: TContext): void => {
  for (const [description, ...steps] of stages) {
    !ctx.flags.silent && console.log(chalk.bold(description))

    for (const step of steps) (step as TCallback)(ctx)
  }
}

/**
 * Public static void main.
 */
export const run = async (_flags: TFlags = {}): Promise<void> => {
  const flags = normalizeFlags(_flags)
  const ctx = getContext(flags)

  try {
    exec(main, ctx)
  } catch (err) {
    ctx.err = err

    exec(fallback, ctx)

    throw err
  }
}
