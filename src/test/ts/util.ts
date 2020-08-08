import {formatFlags} from '../../main/ts/util'
import minimist from 'minimist'

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
          minimist([
            '-w',
            '1',
            '--force',
            '--audit-level=moderate',
            '--only=dev',
          ]),
          ['force', 'audit-level', 'only'],
          ['--force', '--audit-level', 'moderate', '--only', 'dev'],
        ],
      ]

      cases.forEach(([input, picklist, output]) => {
        expect(formatFlags(input, ...picklist)).toEqual(output)
      })
    })
  })
})
