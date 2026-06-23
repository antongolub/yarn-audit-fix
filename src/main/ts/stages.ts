import path from 'node:path'

import fs from 'node:fs'

import semver from 'semver'

import { buildRegistry } from './audit/adapter'
import { TCallback, TContext } from './ifaces'
import * as lf from './lockfile'
import { format, getLockfileType } from './lockfile'
import { createProgress } from './ui'
import { getSelfManifest } from './util'


/** Resolve the runtime + yaf versions (latest yaf straight from the registry). */
export const resolveBins: TCallback = async ({ ctx }) => {
  const { name, version } = getSelfManifest()
  ctx.versions = {
    node: process.version,
    yaf: version,
    yafLatest: await latestPublished(ctx, name, version),
  }
}

/**
 * Latest published version of `name`, read straight from the configured registry
 * (the same scope-aware, host-bound-auth routing as the audit/patch HTTP) — no
 * `npm view` spawn. Best-effort: any failure (offline, 404, throttle) falls back
 * to `fallback`, so the out-of-date nudge just stays quiet instead of breaking
 * the run.
 */
const latestPublished = async (
  ctx: TContext,
  name: string,
  fallback: string,
): Promise<string> => {
  try {
    const packument = await buildRegistry(ctx).packument(name)
    return packument?.distTags?.latest ?? fallback
  } catch {
    return fallback
  }
}

/** Print the runtime digest and version warnings. */
export const printRuntimeDigest: TCallback = ({
  cwd,
  flags,
  versions,
  manifest,
}) => {
  if (flags.silent) {
    return
  }
  const isMonorepo = !!manifest.workspaces

  if (semver.gt(versions.yafLatest, versions.yaf)) {
    console.warn(
      `yarn-audit-fix version ${versions.yaf} is out of date. Install the latest ${versions.yafLatest} for better results`,
    )
  }

  console.log(
    JSON.stringify(
      {
        isMonorepo,
        versions,
        cwd,
        flags,
      },
      undefined,
      2,
    ).replace(/[",:{}]/g, ''),
  )
}

/** Set the process exit code from the error (printing is handled by `run`). */
export const exit: TCallback = ({ err }) => {
  // POSIX convention: a signal-terminated run exits 128 + signal number.
  const bySignal: Record<string, number> = { SIGINT: 130, SIGTERM: 143 }
  process.exitCode = bySignal[err?.signal] ?? (err?.status | 0 || 1)
}

export const patchLockfile: TCallback = async ({ cwd, flags, ctx }) => {
  // Operate on the real lockfile directly — patch is pure (parse → audit →
  // patch → format), so the old copy-to-temp + symlink dance bought nothing.
  const lockfilePath = path.join(cwd, 'yarn.lock')
  const raw = fs.readFileSync(lockfilePath, 'utf-8')
  const lockfileType = getLockfileType(raw)
  // Pass cwd as workspaceRoot so the berry adapter resolves builtin patch hashes.
  const lockfile = lf.parse(raw, lockfileType, cwd)
  // audit / patch / refurbish are all silent registry HTTP, so drive a spinner
  // to show what's happening (no-op off a TTY or under --silent). The pipeline
  // reports through ctx.progress (advisory count, checksum count, summary lines).
  const progress = createProgress(!flags.silent)
  ctx.progress = progress
  try {
    // audit fetches advisories; patch resolves fixes + completes the new
    // transitive closure + prunes the stranded old one.
    progress.label('Fetching advisories…')
    const report = await lf.audit(lockfile, ctx)
    // _patch refines this with live sub-phase counts (Resolving fixes X/Y →
    // Completing the tree N).
    progress.label('Resolving fixes…')
    const patched = await lf.patch(lockfile, report, ctx, lockfileType)
    // Then fill any install-required field the edit left missing (the yarn-berry
    // zip checksum) straight from the registry, so the result is a complete
    // lockfile needing no reconcile `yarn install` (no-op for yarn-classic).
    progress.label('Recomputing checksums…')
    const refurbished = await lf.refurbish(patched, lockfileType, ctx)

    // If the run was aborted (Ctrl+C) during a phase that degrades to a value
    // rather than throwing (e.g. refurbish, whose tarball fetches resolve empty
    // on abort), don't persist a half-finished lockfile.
    if (ctx.signal?.aborted) throw new Error('aborted')
    // The single write lands only after a successful in-memory patch, so a
    // failure leaves the original lockfile untouched. `--dry-run` skips it.
    if (!flags['dry-run']) {
      fs.writeFileSync(lockfilePath, format(refurbished, lockfileType))
    }
  } finally {
    progress.stop()
    ctx.progress = undefined
  }
}

/** Verify the working dir has the files we patch. */
export const verify: TCallback = ({ cwd }) => {
  // yaf only rewrites the lockfile now (no install), so `node_modules` need not
  // be present — just the two files we read.
  for (const resource of ['yarn.lock', 'package.json']) {
    if (!fs.existsSync(path.join(cwd, resource))) {
      throw new Error(`not found: ${resource}`)
    }
  }
}
