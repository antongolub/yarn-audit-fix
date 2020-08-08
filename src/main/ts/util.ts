import cp from 'child_process'
import chalk from 'chalk'
import {FsSymlinkType} from 'fs-extra'
import minimist from 'minimist'

export const invoke = (cmd: string, args: string[], cwd: string) => {
  console.log(chalk.bold('invoke'), cmd, ...args)

  const result = cp.spawnSync(cmd, args, {cwd, stdio: ['inherit', 'inherit', 'inherit']})

  if (result.error || result.status) {
    throw result
  }
}

export const parseFlags = minimist

const checkByLists = (value: any, omitlist: any[], picklist: any[]): boolean =>
  !omitlist.includes(value) && (!picklist.length || picklist.includes(value))

const formatFlag = (key: string): string => (key.length === 1 ? '-' : '--') + key

export const formatFlags = (flags: Record<string, any>, ...picklist: string[]): string[] =>
  Object.keys(flags).reduce<string[]>((memo, key: string) => {
    const omitlist = ['_', '--']
    const value = flags[key]
    const flag = formatFlag(key)

    if (checkByLists(key, omitlist, picklist)) {
      memo.push(flag)

      if (value !== true) {
        memo.push(value)
      }
    }

    return memo
  }, [])

const isWindows = () => process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE as string)

export const getSymlinkType = (type?: string): FsSymlinkType =>
  type === 'junction' && isWindows()
    ? type
    : 'dir'
