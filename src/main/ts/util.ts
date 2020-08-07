import cp from 'child_process'
import chalk from 'chalk'

export const invoke = (cmd: string, args: string[], cwd: string) => {
  const result = cp.spawnSync(cmd, args, {cwd, stdio: ['inherit', 'inherit', 'inherit']})

  console.log(chalk.bold('invoke:'), cmd, ...args)

  if (result.error || result.status) {
    throw result
  }
}
