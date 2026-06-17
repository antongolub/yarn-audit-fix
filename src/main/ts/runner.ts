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
 * Patch yarn.lock with registry advisory data, then reconcile via `yarn install`.
 *
 * Async since v11: advisories are fetched straight from the registry over HTTP
 * (see `audit/registry`), so there is no synchronous `runSync` any more.
 */
export const run = async (_flags: TFlags = {}): Promise<void> => {
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
    await patchLockfile(ctx)
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
