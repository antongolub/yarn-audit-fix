import fs from 'fs-extra'
import synp from 'synp'
import {join} from 'path'
import findCacheDir from 'find-cache-dir'
import chalk from 'chalk'
import {
  invoke,
} from './util'

type TContext = { cwd: string, temp: string }

type TCallback = (cxt: TContext) => void

type TStage = [string, ...TCallback[]]

// https://github.com/antongolub/yarn-audit-fix/issues/2
const fixWorkspaces: TCallback = ({temp}) => {
  const pkgJsonData = JSON.parse(fs.readFileSync(join(temp, 'package.json'), 'utf-8').trim())
  delete pkgJsonData.workspaces

  fs.writeFileSync(join(temp, 'package.json'), JSON.stringify(pkgJsonData, null, 2))
}

const createTempAssets: TCallback = ({temp}) => {
  fs.copyFileSync('yarn.lock', join(temp, 'yarn.lock'))
  fs.copyFileSync('package.json', join(temp, 'package.json'))
  fs.createSymlinkSync('node_modules', join(temp, 'node_modules'), 'dir')
}

const clear: TCallback = ({temp}) => {
  fs.emptyDirSync(temp)
}

const applyYarn: TCallback = ({cwd}) =>
  invoke('yarn', [], cwd)

const yarnImport: TCallback = ({temp}) => {
  invoke('yarn', ['import'], temp)
  fs.copyFileSync(join(temp, 'yarn.lock'), 'yarn.lock')
}

const npmAuditFix: TCallback = ({temp}) =>
    invoke('npm', ['audit', 'fix', '--package-lock-only'], temp)

const yarnLockToPkgLock: TCallback = ({temp}) => {
  const pgkLockJsonData = synp.yarnToNpm(temp)

  fs.writeFileSync(join(temp, 'package-lock.json'), pgkLockJsonData)
  fs.removeSync(join(temp, 'yarn.lock'))
}

export const stages: TStage[] = [
  [
    'Preparing temp assets...',
    clear,
    createTempAssets,
    fixWorkspaces,
  ],
  [
    'Generating package-lock.json from yarn.lock...',
    yarnLockToPkgLock,
  ],
  [
    'Applying npm audit fix...',
    npmAuditFix,
  ],
  [
    'Updating yarn.lock from package-lock.json...',
    yarnImport,
    applyYarn,
    clear,
  ],
  [
    'Done',
  ],
]

export const run = async() => {
  const ctx = {
    cwd: process.cwd(),
    temp: findCacheDir({name: 'yarn-audit-fix', create: true}) + '',
  }

  for (const [description, ...steps] of stages) {
    console.log(chalk.bold(description))

    for (const step of steps) step(ctx)
  }
}
