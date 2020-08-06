import cp from 'child_process'

export const invoke = (cmd: string, args: string[], cwd: string) => {
  const result = cp.spawnSync(cmd, args, {cwd, stdio: ['inherit', 'inherit', 'inherit']})

  console.log('invoke', cmd, ...args)

  if (result.error || result.status) {
    throw result
  }
}
