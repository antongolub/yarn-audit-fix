import cp from 'child_process'

export const invoke = (cmd: string, args: string[], cwd: string) => {
  const result = cp.spawnSync(cmd, args, {cwd})

  console.log('invoke', cmd, ...args)

  if (result.error || result.status !== 0) {
    throw result.error || result.stderr.toString('utf-8')
  }

  console.log(result.stdout.toString('utf-8'))
}
