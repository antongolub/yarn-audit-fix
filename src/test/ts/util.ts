import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { attempt, getWorkspaces, readJson } from '../../main/ts/util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('util', () => {
  describe('attempt', () => {
    it('returns the value, or null when the fn throws', () => {
      expect(attempt(() => 42)).toBe(42)
      expect(
        attempt(() => {
          throw new Error('boom')
        }),
      ).toBeNull()
    })
  })

  describe('getWorkspaces', () => {
    it('returns [] when no workspaces are declared', () => {
      expect(getWorkspaces('/x', {})).toEqual([])
      expect(getWorkspaces('/x', { workspaces: [] })).toEqual([])
    })

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
