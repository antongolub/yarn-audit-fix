import cp from 'child_process'
import chalk from 'chalk'

export const invoke = (cmd: string, args: string[], cwd: string) => {
  console.log(chalk.bold('invoke'), cmd, ...args)

  const result = cp.spawnSync(cmd, args, {cwd, stdio: ['inherit', 'inherit', 'inherit']})

  if (result.error || result.status) {
    throw result
  }
}
