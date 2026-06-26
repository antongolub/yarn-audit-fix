import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getWorkspaces, readJson } from '../../main/ts/util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('util', () => {
  describe('getWorkspaces', () => {
    it('returns paths of found package.json files', () => {
      const cwd = path.resolve(__dirname, '../fixtures/regular-monorepo')
      const manifest = readJson(path.join(cwd, 'package.json'))
      const files = getWorkspaces(cwd, manifest)
      const expected = ['a', 'b'].map((p) =>
        path.join(cwd, 'packages', p, 'package.json'),
      )

      expect(files).toEqual(expected)
    })

    it('resolves a recursive `packages/**` glob with nested members', () => {
      const cwd = path.resolve(__dirname, '../fixtures/nested-monorepo')
      const manifest = readJson(path.join(cwd, 'package.json'))
      const files = getWorkspaces(cwd, manifest)
      const expected = [
        ['stores', 'auth'],
        ['stores', 'auth', 'email'],
        ['stores', 'auth', 'phone'],
      ].map((p) => path.join(cwd, 'packages', ...p, 'package.json'))

      expect(files.sort()).toEqual(expected.sort())
    })
  })
})
