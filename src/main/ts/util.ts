import cp from 'child_process'

export const invoke = (cmd: string, args: string[], cwd: string) => {
  const result = cp.spawnSync(cmd, args, {cwd})

  console.log('invoke', cmd, ...args)

  if (result.error || result.status !== 0) {
    throw result.error || result.stderr.toString('utf-8')
  }

  console.log(result.stdout.toString('utf-8'))
}

export const asyncForEach = async<T extends any[]>(array: T, callback: (a: T[number], index: number, arr: T) => any) => {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array)
  }
}

export const promisify = <T extends (...args: any[]) => any>(fn: T) => (...args: Parameters<T>): Promise<ReturnType<T>> => Promise.resolve(fn(...args))
