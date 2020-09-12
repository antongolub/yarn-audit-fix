import {resolve} from 'path'
import {
  formatFlags,
  getSymlinkType,
  parseFlags,
  getNpm,
} from '../../main/ts/util'

describe('util', () => {
  describe('#formatArgs', () => {
    it('return proper values', () => {
      const cases: [Record<string, any>, string[], string[]][] = [
        [{_: [], '--': []}, [], []],
        [{foo: 'bar'}, [], ['--foo', 'bar']],
        [{f: true}, [], ['-f']],
        [{verbose: true}, [], ['--verbose']],
        [{f: true, foo: 'bar', b: true, baz: 'qux'}, ['f', 'baz'], ['-f', '--baz', 'qux']],
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
      expect(getSymlinkType('junction')).toBe(process.platform === 'win32' ? 'junction' : 'dir')
      expect(getSymlinkType('foo')).toBe('dir')
      expect(getSymlinkType()).toBe('dir')
    })
  })

  describe('#getNpm', () => {
    it('properly resolves npm ref', () => {
      const localNpm = resolve(__dirname, '../../../node_modules/.bin/npm')
      const cases: [boolean, boolean, boolean, string][] = [
        [true, true, false, localNpm],
        [true, true, true, localNpm + '.cmd'],
        [true, false, false, 'npm'],
        [false, true, false, 'npm'],
        [false, false, true, 'npm.cmd'],
      ]

      cases.forEach(([requireNpm7, allowNpm7, isWindows, result]) => {
        expect(getNpm(requireNpm7, allowNpm7, isWindows)).toBe(result)
      })
    })
  })
})
