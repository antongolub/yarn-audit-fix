import { parse, format, parseAuditReport } from '../../main/ts/lockfile/v2'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(__dirname, '../fixtures')

describe('reader', () => {
  it('provides parse/format interop', () => {
    const contents = fs.readFileSync(join(fixtures, 'lockfile/v2/yarn.lock'), 'utf-8')
    expect(format(parse(contents))).toEqual(contents)
    // fs.writeFileSync('foo.yaml', format(parse(contents)))
  })
})

describe('parseReport', () => {
  it('processes yarn2 audit report', () => {
    const input = fs.readFileSync(join(fixtures, 'lockfile/v2/yarn-audit-report.json'), 'utf-8')

    expect(parseAuditReport(input)).toEqual({
      'ansi-regex': {
        patched_versions: '>=5.0.1',
        vulnerable_versions: '>2.1.1 <5.0.1',
        module_name: 'ansi-regex'
      },
      immer: {
        patched_versions: '>=9.0.6',
        vulnerable_versions: '<9.0.6',
        module_name: 'immer'
      },
      'trim-off-newlines': {
        patched_versions: '<0.0.0',
        vulnerable_versions: '<=1.0.1',
        module_name: 'trim-off-newlines'
      },
      'ansi-html': {
        patched_versions: '<0.0.0',
        vulnerable_versions: '<=0.0.7',
        module_name: 'ansi-html'
      },
      '@npmcli/git': {
        patched_versions: '>=2.0.8',
        vulnerable_versions: '<2.0.8',
        module_name: '@npmcli/git'
      },
      'glob-parent': {
        patched_versions: '>=5.1.2',
        vulnerable_versions: '<5.1.2',
        module_name: 'glob-parent'
      },
      browserslist: {
        patched_versions: '>=4.16.5',
        vulnerable_versions: '>=4.0.0 <4.16.5',
        module_name: 'browserslist'
      },
      'trim-newlines': {
        patched_versions: '>=3.0.1',
        vulnerable_versions: '<3.0.1',
        module_name: 'trim-newlines'
      }
    })
  })
})
