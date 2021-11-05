import { TFlow } from './ifaces'
import {
  clear,
  createSymlinks,
  createTempAssets,
  exit,
  npmAuditFix,
  patchLockfile,
  printRuntimeDigest,
  syncLockfile,
  verify,
  yarnImport,
  yarnInstall,
  yarnLockToPkgLock,
} from './stages'

// Compose `npm audit fix` with lockfile converter.
export const convert: TFlow = {
  main: [
    ['Runtime digest', printRuntimeDigest],
    ['Verifying package structure...', verify],
    ['Preparing temp assets...', clear, createTempAssets, createSymlinks],
    ['Generating package-lock.json from yarn.lock...', yarnLockToPkgLock],
    ['Applying npm audit fix...', npmAuditFix],
    [
      'Updating yarn.lock from package-lock.json...',
      yarnImport,
      syncLockfile,
      clear,
    ],
    ['Installing deps update...', yarnInstall],
    ['Done'],
  ],
  fallback: [['Failure!', clear, exit]],
}

// Inject `yarn audit --json` data to lockfile.
export const patch: TFlow = {
  main: [
    ['Runtime digest', printRuntimeDigest],
    ['Verifying package structure...', verify],
    ['Preparing temp assets...', clear, createTempAssets, createSymlinks],
    [
      'Patching yarn.lock with audit data...',
      patchLockfile,
      syncLockfile,
      clear,
    ],
    ['Installing deps update...', yarnInstall],
    ['Done'],
  ],
  fallback: [['Failure!', clear, exit]],
}

// Select `yarn.lock` modification strategy.
export const getFlow = (flow = 'patch'): TFlow => {
  if (flow === 'convert') {
    return convert
  }

  if (flow === 'patch') {
    return patch
  }

  throw new Error(`Unsupported flow: ${flow}`)
}
