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
import {
  attempt,
  bold,
  getSelfManifest,
  getTemp,
  normalizeFlags,
  readJson,
} from './util'

/**
 * Collapse whatever was thrown into one readable line. Commands run with
 * inherited stdio, so a failed spawnSync result carries no captured output —
 * just `{ status, signal, output: [null, …], stdout: null, stderr: null }` —
 * which is noise to print raw (the child already streamed its error to the
 * terminal). Prefer captured output / an Error message, else a terse code.
 */
const formatError = (err: unknown): string => {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const r = err as Record<string, any>
    if (r.error)
      return r.error instanceof Error ? r.error.message : String(r.error)
    const captured =
      r.stderr?.toString?.().trim() || r.stdout?.toString?.().trim()
    if (captured) return captured
    if (r.signal) return `interrupted (${r.signal})`
    if ('status' in r)
      return `command failed (exit code ${r.status ?? 1})`
    if (r.message) return String(r.message)
  }
  return String(err)
}

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

  // Graceful Ctrl+C / kill: tear down the temp dir and exit 128+signal rather
  // than leaving a half-written state behind. A SIGINT received *inside* a sync
  // spawnSync is swallowed (so this callback won't fire mid-`yarn install`), but
  // registering the listener still suppresses Node's abrupt default-terminate —
  // the interrupted install then surfaces on the spawnSync result and flows
  // through the catch below for the same teardown.
  const onAbort = (signal: NodeJS.Signals): void => {
    ctx.err = { signal }
    !flags.silent && console.error(bold(`\nAborted (${signal})`))
    attempt(() => clear(ctx))
    exit(ctx)
    process.exit(process.exitCode || 130)
  }
  process.on('SIGINT', onAbort)
  process.on('SIGTERM', onAbort)

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

    !flags.silent && console.error(formatError(err))
    log(err?.signal ? 'Aborted!' : 'Failure!')
    clear(ctx)
    exit(ctx)

    throw err
  } finally {
    process.removeListener('SIGINT', onAbort)
    process.removeListener('SIGTERM', onAbort)
  }
}
