import { Command } from 'commander'
import { join, resolve } from 'path'

import {
  formatFlags,
  getNpm,
  getSymlinkType,
  getTemp,
  getWorkspaces,
  isWindows,
  normalizeFlags,
  readJson,
} from '../../main/ts/util'

describe('util', () => {
  describe('#formatArgs', () => {
    it('return proper values', () => {
      const cases: [Record<string, any>, string[], string[]][] = [
        [{ _: [], '--': [] }, [], []],
        [{ foo: 'bar' }, [], ['--foo', 'bar']],
        [{ f: true }, [], ['-f']],
        [{ verbose: true }, [], ['--verbose']],
        [
          { f: true, foo: 'bar', b: true, baz: 'qux' },
          ['f', 'baz'],
          ['-f', '--baz', 'qux'],
        ],
        [
          new Command()
            .option('-w')
            .option('--force')
            .option('--audit-level <level>')
            .option('--bar')
            .option('--only <scope>')
            .option('-b <b>')
            .parse(
              [
                '-w',
                '1',
                '--force',
                '--audit-level=moderate',
                '--only=dev',
                '--',
                '--bar',
                '-b',
                '2',
              ],
              { from: 'user' },
            )
            .opts(),
          ['force', 'audit-level', 'only', 'bar', 'b'],
          ['--force', '--audit-level', 'moderate', '--only', 'dev'],
        ],
      ]

      cases.forEach(([input, picklist, output]) => {
        expect(formatFlags(normalizeFlags(input), ...picklist)).toEqual(output)
      })
    })
  })

  describe('#getSymlinkType', () => {
    it('resolves type by system profile and arg', () => {
      process.env.OSTYPE = 'msys'
      expect(getSymlinkType('junction')).toBe('junction')
      expect(getSymlinkType('foo')).toBe('dir')
      expect(getSymlinkType()).toBe('dir')

      process.env.OSTYPE = 'unknown'
      expect(getSymlinkType('junction')).toBe(
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      expect(getSymlinkType('foo')).toBe('dir')
      expect(getSymlinkType()).toBe('dir')
    })
  })

  describe('#getNpm', () => {
    const isWin = isWindows()
    const cmd = isWin ? 'npm.cmd' : 'npm'
    const localNpm = resolve(__dirname, '../../../node_modules/.bin', cmd)
    const cases: [any, string?, string?][] = [
      ['local', localNpm],
      ['system', cmd],
      ['unknown', undefined, 'Unsupported npm path value: unknown'],
      [NaN, undefined, 'Unsupported npm path value: NaN'],
    ]
    cases.forEach(([npmPath, result, err]) => {
      it(`resolves npm ref: npmPath=${npmPath},  isWin=${isWin}`, () => {
        if (err) {
          expect(() => getNpm(npmPath)).toThrowError()
        } else {
          expect(getNpm(npmPath)).toBe(result)
        }
      })
    })
  })

  describe('#getTemp', () => {
    it('properly resolves temp dir path', () => {
      const pwd = process.cwd()
      const tempdir = resolve(__dirname, '../temp')
      const cases: [string, string | undefined, string][] = [
        [pwd, tempdir, tempdir],
        [pwd, undefined, resolve(pwd, 'node_modules/.cache/yarn-audit-fix')],
      ]

      cases.forEach(([cwd, temp, result]) => {
        expect(getTemp(cwd, temp)).toMatch(result)
      })
    })
  })

  describe('getWorkspaces', () => {
    it('returns paths of found package.json files', () => {
      const cwd = resolve(__dirname, '../fixtures/regular-monorepo')
      const manifest = readJson(join(cwd, 'package.json'))
      const files = getWorkspaces(cwd, manifest)
      const expected = ['a', 'b'].map((p) =>
        join(cwd, 'packages', p, 'package.json'),
      )

      expect(files).toEqual(expected)
    })
  })
})
