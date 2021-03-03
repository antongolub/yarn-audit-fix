import chalk from 'chalk'
import { join } from 'path'

import { TCallback, TStage } from './ifaces'
import {
  clear,
  createSymlinks,
  createTempAssets,
  npmAuditFix,
  printRuntimeDigest,
  yarnImport,
  yarnInstall,
  yarnLockToPkgLock,
} from './stages'
import { getTemp, readJson } from './util'

export const stages: TStage[] = [
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

/**
 * Public static void main.
 */
export const run = async (flags: Record<string, any> = {}): Promise<void> => {
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

    for (const step of steps) (step as TCallback)(ctx)
  }
}
