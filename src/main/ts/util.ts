import cp from 'child_process'

export const invoke = (cmd: string, args: string[], cwd: string, stdio: any[] = ['inherit', 'inherit', 'inherit']) => {
  const result = cp.spawnSync(cmd, args, {cwd, stdio})

  console.log('invoke', cmd, ...args)

  if (result.error || result.status) {
    throw result
  }
}
