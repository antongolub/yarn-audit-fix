import chalk from 'chalk'
import { join } from 'path'

import {TCallback, TContext, TFlags, TFlow, TStage} from './ifaces'
import { convert } from './flow'
import { getTemp, normalizeFlags, readJson } from './util'

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
 * Select `yarn.lock` modification strategy.
 * @param flags
 */
export const getFlow = ({ flow = 'convert' }: Record<string, any> = {}): TFlow => {
  if (flow === 'convert') {
    return convert
  }

  throw new Error(`Unsupported flow: ${flow}`)
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
  const flow = getFlow(flags)

  try {
    exec(flow.main, ctx)
  } catch (err) {
    ctx.err = err

    exec(flow.fallback, ctx)

    throw err
  }
}
