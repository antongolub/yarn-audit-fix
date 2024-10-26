import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

import type { TFlags, TFlagsMapping } from '../../main/ts'
import {
  formatFlags,
  getNpm,
  getSymlinkType,
  getTemp,
  getWorkspaces,
  isWindows,
  mapFlags,
  normalizeFlags,
  readJson,
} from '../../main/ts/util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OSTYPE = process.env.OSTYPE

describe('util', () => {
  describe('#mapFlags', () => {
    it('provides cross-util flags conversion', () => {
      const cases: [[TFlags, TFlagsMapping, TFlags]] = [
        [
          {
            only: 'prod',
            'audit-level': 'low',
          },
          {
            'audit-level': 'level',
            only: {
              key: 'groups',
              values: {
                prod: 'dependencies',
                dev: 'devDependencies',
              },
            },
          },
          {
            groups: 'dependencies',
            level: 'low',
          },
        ],
      ]

      cases.forEach(([flags, mapping, result]) => {
        expect(mapFlags(flags, mapping)).toEqual(result)
      })
    })
  })

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
        [{ exclude: [] }, ['exclude'], []],
        [
          { exclude: ['@scope/package'] }, // eslint-disable-line sonarjs/no-duplicate-string
          ['exclude'],
          ['--exclude', '@scope/package'],
        ],
        [
          { exclude: ['@scope/package', 'another-package'] },
          ['exclude'],
          ['--exclude', '@scope/package', '--exclude', 'another-package'],
        ],
        [{ verbose: true, exclude: [] }, [], ['--verbose']],
      ]

      cases.forEach(([input, picklist, output]) => {
        expect(formatFlags(normalizeFlags(input), ...picklist)).toEqual(output)
      })
    })
  })

  describe('#getSymlinkType', () => {
    it('resolves type by system profile and arg', () => {
      process.env.OSTYPE = 'msys'
      expect(getSymlinkType()).toBe('junction')
      expect(getSymlinkType('foo')).toBe('foo')
      expect(getSymlinkType('dir')).toBe('dir')

      process.env.OSTYPE = 'unknown'
      expect(getSymlinkType()).toBe(
        process.platform === 'win32' ? 'junction' : 'dir',
      )

      process.env.ostype = DEFAULT_OSTYPE
    })
  })

  describe('#getNpm', () => {
    const isWin = isWindows()
    const cmd = isWin ? 'npm.cmd' : 'npm'
    const localNpm = resolve(__dirname, '../../../node_modules/.bin', cmd)
    const cases: [any, string?, string?][] = [
      ['local', localNpm],
      ['system', cmd],
      [cmd, cmd],
      [localNpm, localNpm],
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
      const cases: [string, string | undefined, string | RegExp][] = [
        [pwd, tempdir, tempdir],
        [pwd, undefined, /tempy-/],
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
