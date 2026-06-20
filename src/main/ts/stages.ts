import path from 'node:path'

import fs from 'node:fs'

import semver from 'semver'

import { TCallback } from './ifaces'
import * as lf from './lockfile'
import { format, getLockfileType } from './lockfile'
import {
  formatFlags,
  getBinVersion,
  getNpm,
  getSelfManifest,
  getYarn,
  invoke,
} from './util'


/** Resolve bin paths and tool versions. */
export const resolveBins: TCallback = ({ ctx, flags }) => {
  const yafManifest = getSelfManifest()
  ctx.bins = {
    yarn: getYarn(),
    npm: getNpm(flags['npm-path']),
  }
  ctx.versions = {
    node: getBinVersion('node'),
    npm: getBinVersion(ctx.bins.npm),
    yarn: getBinVersion(ctx.bins.yarn),
    yaf: yafManifest.version,
    yafLatest: invoke(
      ctx.bins.npm,
      ['view', yafManifest.name, 'version'],
      process.cwd(),
      true,
      false,
    ) as string,
  }
}

/** Print the runtime digest and version warnings. */
export const printRuntimeDigest: TCallback = ({
  cwd,
  flags,
  bins,
  versions,
  manifest,
}) => {
  if (flags.silent) {
    return
  }
  const isMonorepo = !!manifest.workspaces
  // NOTE npm > 7.0.0 provides monorepo support
  if (
    isMonorepo &&
    (semver.parse(versions.npm as string)?.major as number) < 7
  ) {
    console.warn(
      "This project looks like monorepo, so it's recommended to use `npm v7+` to process workspaces",
    )
  }

  if (semver.gt(versions.yafLatest, versions.yaf)) {
    console.warn(
      `yarn-audit-fix version ${versions.yaf} is out of date. Install the latest ${versions.yafLatest} for better results`,
    )
  }

  console.log(
    JSON.stringify(
      {
        isMonorepo,
        bins,
        versions,
        cwd,
        flags,
      },
      undefined,
      2,
    ).replace(/[",:{}]/g, ''),
  )
}

/** Run yarn install to refresh packages after the lockfile update. */
export const yarnInstall: TCallback = ({ cwd, flags, versions, bins }) => {
  if (flags['dry-run']) {
    return
  }

  semver.gte(versions.yarn, '2.0.0')
    ? invoke(
        bins.yarn,
        ['install', '--mode=update-lockfile'],
        cwd,
        flags.silent,
      )
    : invoke(
        bins.yarn,
        [
          'install',
          '--update-checksums',
          ...formatFlags(flags, 'verbose', 'silent', 'registry'),
          // audit-fix only reconciles the lockfile, so the project's own engine
          // constraints — a transitive demanding a newer Node than the one
          // running yaf (e.g. node-releases@>=18 on Node 16) — must never abort
          // the run. Classic-only flag; berry doesn't enforce engines here.
          '--ignore-engines',
        ],
        cwd,
        flags.silent,
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
  // audit + patch both hit the registry over HTTP now (async): audit fetches
  // advisories, patch resolves fixes + completes the new transitive closure.
  const report = await lf.audit(lockfile, ctx)
  const patched = await lf.patch(lockfile, report, ctx, lockfileType)

  // The single write lands only after a successful in-memory patch, so a failure
  // leaves the original lockfile untouched. `--dry-run` skips it entirely.
  if (!flags['dry-run']) {
    fs.writeFileSync(lockfilePath, format(patched, lockfileType))
  }
}

/** Verify the working dir has the required files. */
export const verify: TCallback = ({ cwd, versions }) => {
  const required = ['yarn.lock', 'package.json']

  // NOTE yarn 2+ in PnP mode does not create `node_modules` dir
  if (semver.lt(versions.yarn, '2.0.0')) {
    required.push('node_modules')
  }

  required.forEach((resource) => {
    if (!fs.existsSync(path.join(cwd, resource))) {
      throw new Error(`not found: ${resource}`)
    }
  })
}
