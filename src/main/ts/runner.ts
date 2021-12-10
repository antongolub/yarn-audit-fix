import chalk from 'chalk'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getFlow } from './flows'
import { TCallback, TContext, TFlags, TFlow, TStage } from './ifaces'
import {
  getNpm,
  getTemp,
  getYarn,
  invoke,
  normalizeFlags,
  pkgDir,
  readJson,
} from './util'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Build running context.
 */
export const getContext = (flags: TFlags = {}): TContext => {
  const cwd = flags.cwd || process.cwd()
  const manifest = readJson(join(cwd, 'package.json'))
  const temp = getTemp(cwd, flags.temp)
  const bins: Record<string, string> = {
    yarn: getYarn(),
    npm: getNpm(flags['npm-path']),
  }
  const versions: Record<string, string> = {
    node: invoke('node', ['--version'], temp, true, false),
    npm: invoke(bins.npm, ['--version'], temp, true, false),
    yarn: invoke(bins.yarn, ['--version'], temp, true, false),
    yaf: readJson(
      join(pkgDir(__dirname) + '', 'package.json'), // eslint-disable-line
    ).version,
    yafLatest: invoke(
      bins.npm,
      ['view', 'yarn-audit-fix', 'version'],
      temp,
      true,
      false,
    ) as string,
  }

  const ctx = {
    cwd,
    temp,
    flags,
    manifest,
    versions,
    bins,
  } as TContext
  ctx.ctx = ctx

  return ctx
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
export const runSync = (_flags: TFlags = {}, _flow?: TFlow): void => {
  const flags = normalizeFlags(_flags)
  const ctx = getContext(flags)
  const flow = _flow || getFlow(flags.flow)

  try {
    exec(flow.main, ctx)
  } catch (err) {
    ctx.err = err

    exec(flow.fallback, ctx)

    throw err
  }
}

// Legacy async implementation
export const run = (_flags: TFlags = {}, _flow?: TFlow): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      runSync(_flags, _flow)
      resolve()
    } catch (e) {
      reject(e)
    }
  })

run.sync = runSync
