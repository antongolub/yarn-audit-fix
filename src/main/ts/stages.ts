import path from 'node:path'

import fs from 'fs-extra'
import semver from 'semver'

import { TCallback } from './ifaces'
import * as lf from './lockfile'
import { format, getLockfileType } from './lockfile'
import {
  formatFlags,
  getBinVersion,
  getNpm,
  getSelfManifest,
  getSymlinkType,
  getWorkspaces,
  getYarn,
  invoke,
} from './util'


/**
 * Resolve bins.
 */
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

/**
 * Print runtime context digest.
 */
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

  // NOTE yarn > v3.3.0 fixed plugin-npm-cli minor compatibility
  // https://github.com/yarnpkg/berry/pull/4356#issuecomment-1316653931
  if (semver.gt('3.3.0', versions.yarn) && (flags.exclude || flags.ignore)) {
    console.warn(
      `This project yarn version ${versions.yarn} doesn't support the 'exclude' and 'ignore' flags. Please upgrade to yarn 3.3.0 or higher to use those flags`,
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

/**
 * Prepare temp assets.
 * @param {TContext} cxt
 * @return {void}
 */
export const createTempAssets: TCallback = ({ cwd, temp }) => {
  fs.copyFileSync(path.join(cwd, 'yarn.lock'), path.join(temp, 'yarn.lock'))
  fs.copyFileSync(path.join(cwd, 'package.json'), path.join(temp, 'package.json'))
  fs.existsSync(path.join(cwd, '.npmrc')) &&
    fs.copyFileSync(path.join(cwd, '.npmrc'), path.join(temp, '.npmrc'))
  fs.existsSync(path.join(cwd, '.yarnrc')) &&
    fs.copyFileSync(path.join(cwd, '.yarnrc'), path.join(temp, '.yarnrc'))
}

/**
 * Provide symlinks to node_modules and workspaces
 * @param {TContext} cxt
 * @return {void}
 */
export const createSymlinks: TCallback = ({ temp, flags, cwd, manifest }) => {
  const symlinkType = getSymlinkType(flags.symlink)
  const workspaces = getWorkspaces(cwd, manifest)
  const links = [
    path.join(cwd, 'node_modules'),
    path.join(cwd, '.yarn'),
    ...workspaces.map((ws) => path.dirname(ws)),
  ]

  links.forEach((link: string) => {
    const rel = path.relative(cwd, link)
    const from = path.join(cwd, rel)
    const to = path.join(temp, rel)

    fs.existsSync(from) && fs.createSymlinkSync(from, to, symlinkType)
  })
}

export const syncLockfile: TCallback = ({ temp, flags }) => {
  if (flags.dryRun) {
    return
  }

  fs.copyFileSync(path.join(temp, 'yarn.lock'), 'yarn.lock')
}

/**
 * Apply yarn install to fetch packages after yarn.lock update.
 * @param {TContext} cxt
 * @return {void}
 */
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
          ...formatFlags(
            flags,
            'verbose',
            'silent',
            'registry',
            'ignore-engines',
          ),
        ],
        cwd,
        flags.silent,
      )
}
/**
 * Clean up temporaries.
 * @param {TContext} cxt
 * @return {void}
 */
export const clear: TCallback = ({ temp }) => fs.emptyDirSync(temp)

/**
 * Exit on error.
 * @param {TContext} cxt
 * @return {void}
 */
export const exit: TCallback = ({ flags, err }) => {
  !flags.silent && console.error(err)
  process.exitCode = err?.status | 0 || 1
}

export const patchLockfile: TCallback = ({ temp, cwd, ctx }) => {
  const lockfilePath = path.join(temp, 'yarn.lock')
  const raw = fs.readFileSync(lockfilePath, 'utf-8')
  const lockfileType = getLockfileType(raw)
  // Pass cwd as workspaceRoot so the berry adapter resolves builtin patch hashes.
  const lockfile = lf.parse(raw, lockfileType, cwd)
  const report = lf.audit(ctx, lockfileType)
  const patched = lf.patch(lockfile, report, ctx, lockfileType)

  fs.writeFileSync(lockfilePath, format(patched, lockfileType))
}

/**
 * Check that everything is fine with pkg dir.
 * @param {TContext} cxt
 * @return {void}
 */
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
