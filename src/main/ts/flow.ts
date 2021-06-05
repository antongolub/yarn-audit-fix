import {TFlow} from './ifaces'
import {
  clear,
  createSymlinks,
  createTempAssets,
  exit,
  npmAuditFix,
  patchLockfile,
  printRuntimeDigest,
  yarnImport,
  yarnInstall,
  yarnLockToPkgLock
} from "./stages";

// Compose `npm audit fix` with lockfile converter.
export const convert: TFlow = {
  main: [
    ['Runtime digest', printRuntimeDigest],
    ['Preparing temp assets...', clear, createTempAssets, createSymlinks],
    ['Generating package-lock.json from yarn.lock...', yarnLockToPkgLock],
    ['Applying npm audit fix...', npmAuditFix],
    [
      'Updating yarn.lock from package-lock.json...',
      yarnImport,
      yarnInstall,
      clear,
    ],
    ['Done'],
  ],
  fallback: [
    ['Failure!', clear, exit]
  ]
}

// Inject `yarn audit --json` data to lockfile.
export const patch: TFlow = {
  main: [
    ['Runtime digest', printRuntimeDigest],
    ['Preparing temp assets...', clear, createTempAssets, createSymlinks],
    ['Generating package-lock.json from yarn.lock...', yarnLockToPkgLock],
    ['Patching yarn.lock with audit data...', patchLockfile, yarnInstall, clear],
    ['Done'],
  ],
  fallback: [
    ['Failure!', clear, exit]
  ]
}
