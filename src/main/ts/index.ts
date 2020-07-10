import fs from 'fs-extra'
import synp from 'synp'
import {invoke} from './invoke'

type TContext = { cwd: string }

type TCallback = (cxt: TContext) => void

type TStage = [string, ...TCallback[]]

const fixWorkspaces: TCallback = ({cwd}: TContext) => {
  // save original file for rollback
  fs.copyFileSync('package.json', 'origin.package.json')

  // https://github.com/antongolub/yarn-audit-fix/issues/2
  const pkgJsonData = JSON.parse(fs.readFileSync('package.json', 'utf-8').trim())
  delete pkgJsonData.workspaces

  fs.writeFileSync('package.json', JSON.stringify(pkgJsonData, null, 2))
}

const clearTempData: TCallback = () => {
  fs.copyFileSync('origin.package.json', 'package.json')
  fs.removeSync('origin.package.json')
  fs.removeSync('package-lock.json')
}

const applyYarn: TCallback = ({cwd}) =>
  invoke('yarn', [], cwd)

const yarnImport: TCallback = ({cwd}) => {
  fs.removeSync('yarn.lock')
  invoke('yarn', ['import'], cwd)
}

const npmAuditFix: TCallback = ({cwd}) =>
    invoke('npm', ['audit', 'fix', '--package-lock-only'], cwd)

const yarnLockToPkgLock: TCallback = ({cwd}) => {
  const pgkLockJsonData = synp.yarnToNpm(cwd)

  fs.writeFileSync('package-lock.json', pgkLockJsonData)
}

export const stages: TStage[] = [
  [
    'Generating package-lock.json from yarn.lock...',
    applyYarn,
    fixWorkspaces,
    yarnLockToPkgLock,
  ],
  [
    'Applying npm audit fix...',
    npmAuditFix,
  ],
  [
    'Updating yarn.lock from package-lock.json...',
    yarnImport,
    clearTempData,
    applyYarn,
  ],
  [
    'Done',
  ],
]

export const run = () => {
  const cxt = {cwd: process.cwd()}

  stages.forEach(([description, ...cbs]) => {
    console.log(description)

    cbs.forEach(cb => cb(cxt))
  })
}
