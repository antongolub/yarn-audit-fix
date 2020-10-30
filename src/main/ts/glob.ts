import bashGlob from 'bash-glob'
import bashPath from 'bash-path'

export const glob = (...args: Parameters<typeof bashGlob.sync>): string[] => {
  if (bashPath() === null) {
    throw new TypeError('`bash` must be installed')
  }

  return bashGlob.sync(...args)
}
