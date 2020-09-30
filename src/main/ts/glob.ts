import bashPath from 'bash-path'
import bashGlob from 'bash-glob'

export const glob = (...args: Parameters<typeof bashGlob.sync>) => {
  if (!bashPath) {
    throw new TypeError('`bash` must be installed')
  }

  return bashGlob.sync(...args)
}
