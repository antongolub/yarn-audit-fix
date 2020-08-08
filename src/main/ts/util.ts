import cp from 'child_process'
import chalk from 'chalk'

export const invoke = (cmd: string, args: string[], cwd: string) => {
  console.log(chalk.bold('invoke'), cmd, ...args)

  const result = cp.spawnSync(cmd, args, {cwd, stdio: ['inherit', 'inherit', 'inherit']})

  if (result.error || result.status) {
    throw result
  }
}

export const formatFlags = (flags: Record<string, any>, ...picklist: string[]): string[] => Object.keys(flags).reduce<string[]>((memo, key: string) => {
  if (key !== '_' && key !== '--' && (!picklist.length || picklist.includes(key))) {
    const value = flags[key]
    const flag = (key.length === 1 ? '-' : '--') + key

    if (value === true) {
      memo.push(flag)
    }
    else {
      memo.push(flag, value)
    }
  }

  return memo
}, [])
