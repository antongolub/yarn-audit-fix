import {join, resolve} from 'path'

import {
  formatFlags,
  getNpm,
  getSymlinkType,
  getTemp,
  getWorkspaces,
  isWindows,
  parseFlags, readJson,
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
          parseFlags([
            '-w',
            '1',
            '--force',
            '--audit-level=moderate',
            '--only=dev',
            '--',
            '--bar',
            '-b',
            '2',
          ]),
          ['force', 'audit-level', 'only', 'bar', 'b'],
          ['--force', '--audit-level', 'moderate', '--only', 'dev'],
        ],
      ]

      cases.forEach(([input, picklist, output]) => {
        expect(formatFlags(input, ...picklist)).toEqual(output)
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
    const cases: [boolean, boolean, boolean, string][] = [
      [true, true, true, localNpm],
      [false, true, true, localNpm],
      [true, false, true, cmd],
      [false, false, true, cmd],
    ]
    cases.forEach(([requireNpm7, allowNpm7, silent, result]) => {
      it(`resolves npm ref: requireNpm7=${requireNpm7}, allowNpm7=${allowNpm7}, silent=${silent}, isWin=${isWin}`, () => {
        expect(getNpm(requireNpm7, allowNpm7, silent)).toBe(result)
      })
    })
  })

  describe('#getTemp', () => {
    it('properly resolves temp dir path', () => {
      const pwd = process.cwd()
      const tempdir = resolve(__dirname, '../temp')
      const cases: [string, string | undefined, string][] = [
        [pwd, undefined, resolve(pwd, 'node_modules/.cache/yarn-audit-fix')],
        [pwd, tempdir, tempdir],
      ]

      cases.forEach(([cwd, temp, result]) => {
        expect(getTemp(cwd, temp)).toBe(result)
      })
    })
  })

  describe('getWorkspaces', () => {
    it('returns paths of found package.json files', () => {
      const cwd = resolve(__dirname, '../fixtures/regular-monorepo')
      const manifest = readJson(join(cwd, 'package.json'))
      const files = getWorkspaces(cwd, manifest)
      const expected = ['a', 'b'].map((p) => join(cwd, 'packages', p, 'package.json'))

      expect(files).toEqual(expected)
    })
  })
})
