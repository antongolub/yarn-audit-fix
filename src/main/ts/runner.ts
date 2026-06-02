import path from 'node:path'

import { TContext, TFlags } from './ifaces'
import {
  clear,
  createSymlinks,
  createTempAssets,
  exit,
  patchLockfile,
  printRuntimeDigest,
  resolveBins,
  syncLockfile,
  verify,
  yarnInstall,
} from './stages'
import { bold, getSelfManifest, getTemp, normalizeFlags, readJson } from './util'

/**
 * Build running context.
 */
export const getContext = (flags: TFlags = {}): TContext => {
  const cwd = flags.cwd || process.cwd()
  const manifest = readJson(path.join(cwd, 'package.json'))
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
 * Inject `yarn audit --json` data straight into the lockfile graph.
 */
export const runSync = (_flags: TFlags = {}): void => {
  if (_flags.V) {
    console.log(getSelfManifest().version)
    return
  }

  const flags = normalizeFlags(_flags)
  const ctx = getContext(flags)
  const log = (note: string) => !flags.silent && console.log(bold(note))

  try {
    log('Resolve bins')
    resolveBins(ctx)
    log('Runtime digest')
    printRuntimeDigest(ctx)
    log('Verifying package structure...')
    verify(ctx)
    log('Preparing temp assets...')
    clear(ctx)
    createTempAssets(ctx)
    createSymlinks(ctx)
    log('Patching yarn.lock with audit data...')
    patchLockfile(ctx)
    syncLockfile(ctx)
    clear(ctx)
    log('Installing deps update...')
    yarnInstall(ctx)
    log('Done')
  } catch (err: any) {
    ctx.err = err

    !flags.silent &&
      console.error(
        err.stderr?.toString?.() ||
          err.stdout?.toString?.() ||
          err.error ||
          err.status ||
          err,
      )
    log('Failure!')
    clear(ctx)
    exit(ctx)

    throw err
  }
}

// Promisified alias for `runSync`.
export const run = (_flags: TFlags = {}): Promise<void> =>
  new Promise((resolve, reject) => {
    try {
      runSync(_flags)
      resolve()
    } catch (e) {
      reject(e)
    }
  })

run.sync = runSync
