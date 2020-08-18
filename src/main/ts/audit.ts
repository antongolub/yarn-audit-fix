import npm from 'npm'

export const audit = (auditArgs: string[], cwd: string) => {
  let _reject: any
  let _resolve: any

  const promise = new Promise((resolve, reject) => {
    _resolve = resolve
    _reject = reject
  })

  const config = {
    prefix: cwd,
  }

  npm.load(config, (err) => {
    if (err) {
      _reject(err)
      return
    }

    // @ts-ignore
    npm.commands.audit(auditArgs, (err) => { // TODO fix npm typings
      if (err) {
        _reject(err)
      }
      else {
        _resolve()
      }
    })
  })

  return promise
}
