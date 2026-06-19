import path from 'node:path'

import fs from 'node:fs'

import semver from 'semver'

import { TCallback } from './ifaces'
import * as lf from './lockfile'
import { format, getLockfileType } from './lockfile'
import {
  createSymlink,
  emptyDir,
  formatFlags,
  getBinVersion,
  getNpm,
  getSelfManifest,
  getSymlinkType,
  getWorkspaces,
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
  temp,
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
        temp,
        cwd,
        flags,
      },
      undefined,
      2,
    ).replace(/[",:{}]/g, ''),
  )
}

/** Copy yarn.lock, package.json and rc files into temp. */
export const createTempAssets: TCallback = ({ cwd, temp }) => {
  fs.copyFileSync(path.join(cwd, 'yarn.lock'), path.join(temp, 'yarn.lock'))
  fs.copyFileSync(path.join(cwd, 'package.json'), path.join(temp, 'package.json'))
  fs.existsSync(path.join(cwd, '.npmrc')) &&
    fs.copyFileSync(path.join(cwd, '.npmrc'), path.join(temp, '.npmrc'))
  fs.existsSync(path.join(cwd, '.yarnrc')) &&
    fs.copyFileSync(path.join(cwd, '.yarnrc'), path.join(temp, '.yarnrc'))
}

/** Symlink node_modules, .yarn and workspaces into temp. */
export const createSymlinks: TCallback = ({ temp, flags, cwd, manifest }) => {
  const symlinkType = getSymlinkType(flags.symlink)
  const workspaces = getWorkspaces(cwd, manifest)
  const links = [
    path.join(cwd, 'node_modules'),
    path.join(cwd, '.yarn'),
    ...workspaces.map((ws) => path.dirname(ws)),
  ]

  // A directory symlink exposes its target's real children, so linking a
  // workspace that is an ancestor of another (nested workspaces, e.g.
  // `packages/stores/auth` that itself contains `packages/stores/auth/email`)
  // already brings the whole subtree into temp. A subsequent link for the
  // descendant would resolve to an existing path through that symlink → EEXIST.
  // Keep only the topmost links — the ancestor already covers everything below
  // it, so `yarn install` in temp still discovers the nested workspaces.
  const isNestedUnder = (child: string, parent: string): boolean =>
    child !== parent && (child + path.sep).startsWith(parent + path.sep)
  const topmost = links.filter((l) => !links.some((p) => isNestedUnder(l, p)))

  topmost.forEach((link: string) => {
    const to = path.join(temp, path.relative(cwd, link))

    fs.existsSync(link) && createSymlink(link, to, symlinkType)
  })
}

export const syncLockfile: TCallback = ({ temp, flags }) => {
  if (flags.dryRun) {
    return
  }

  fs.copyFileSync(path.join(temp, 'yarn.lock'), 'yarn.lock')
}

/** Run yarn install to refresh packages after the lockfile update. */
export const yarnInstall: TCallback = ({ cwd, flags, versions, bins }) => {
  if (flags.dryRun) {
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
/** Empty the temp dir. */
export const clear: TCallback = ({ temp }) => emptyDir(temp)

/** Set the process exit code from the error (printing is handled by `run`). */
export const exit: TCallback = ({ err }) => {
  // POSIX convention: a signal-terminated run exits 128 + signal number.
  const bySignal: Record<string, number> = { SIGINT: 130, SIGTERM: 143 }
  process.exitCode = bySignal[err?.signal] ?? (err?.status | 0 || 1)
}

export const patchLockfile: TCallback = async ({ temp, cwd, ctx }) => {
  const lockfilePath = path.join(temp, 'yarn.lock')
  const raw = fs.readFileSync(lockfilePath, 'utf-8')
  const lockfileType = getLockfileType(raw)
  // Pass cwd as workspaceRoot so the berry adapter resolves builtin patch hashes.
  const lockfile = lf.parse(raw, lockfileType, cwd)
  // audit now hits the registry directly (async) instead of spawning yarn/npm.
  const report = await lf.audit(lockfile, ctx)
  const patched = lf.patch(lockfile, report, ctx, lockfileType)

  fs.writeFileSync(lockfilePath, format(patched, lockfileType))
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
