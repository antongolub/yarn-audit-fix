import path from 'node:path'

import { TContext, TFlags } from './ifaces'
import {
  exit,
  patchLockfile,
  printRuntimeDigest,
  resolveBins,
  verify,
  yarnInstall,
} from './stages'
import { bold, getSelfManifest, normalizeFlags, readJson } from './util'

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
  const ctx = {
    cwd,
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

  // Graceful Ctrl+C / kill: exit 128+signal with a clean message instead of a
  // raw stack. A SIGINT received *inside* a sync spawnSync is swallowed (so this
  // callback won't fire mid-`yarn install`), but registering the listener stops
  // Node's abrupt default-terminate — the interrupted install then surfaces on
  // the spawnSync result and flows through the catch below.
  const onAbort = (signal: NodeJS.Signals): void => {
    ctx.err = { signal }
    !flags.silent && console.error(bold(`\nAborted (${signal})`))
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
    log('Patching yarn.lock with audit data...')
    await patchLockfile(ctx)
    log('Installing deps update...')
    yarnInstall(ctx)
    log('Done')
  } catch (err: any) {
    ctx.err = err

    !flags.silent && console.error(formatError(err))
    log(err?.signal ? 'Aborted!' : 'Failure!')
    exit(ctx)

    throw err
  } finally {
    process.removeListener('SIGINT', onAbort)
    process.removeListener('SIGTERM', onAbort)
  }
}
