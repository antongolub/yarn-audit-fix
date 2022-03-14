import chalk from 'chalk'
import { join } from 'node:path'

import { getFlow } from './flows'
import { TContext, TFlags, TFlow, TStage } from './ifaces'
import { getSelfManifest, getTemp, normalizeFlags, readJson } from './util'

/**
 * Build running context.
 */
export const getContext = (flags: TFlags = {}): TContext => {
  const cwd = flags.cwd || process.cwd()
  const manifest = readJson(join(cwd, 'package.json'))
  const temp = getTemp(cwd, flags.temp)
  const ctx = {
    cwd,
    temp,
    flags,
    manifest,
    versions: {},
    bins: {},
  } as TContext
  ctx.ctx = ctx

  return ctx
}

/**
 * Run cmd stack.
 * @param stages
 * @param ctx
 */
export const exec = (stages: TStage, ctx: TContext): void => {
  for (const step of stages.flat(5)) {
    if (typeof step === 'string') {
      !ctx.flags.silent && console.log(chalk.bold(step))
    } else if (typeof step === 'function') {
      step(ctx)
    }
  }
}

/**
 * Public static void main.
 */
export const runSync = (_flags: TFlags = {}, _flow?: TFlow): void => {
  if (_flags.V) {
    console.log(getSelfManifest().version)
    return
  }

  const flags = normalizeFlags(_flags)
  const ctx = getContext(flags)
  const flow = _flow || getFlow(flags.flow)

  try {
    exec(flow.main, ctx)
  } catch (err: any) {
    ctx.err = err

    !flags.silent && console.error((err.stderr?.toString() || err.error || err.status || err))
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
