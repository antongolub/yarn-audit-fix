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
  fit('processes yarn2 audit report', () => {
    const input = fs.readFileSync(join(fixtures, 'lockfile/v2/yarn-audit-report.json'), 'utf-8')

    expect(parseAuditReport(input)).toEqual({
      'ansi-regex': {
        patched_versions: '>=5.0.1',
        vulnerable_versions: '>2.1.1 <5.0.1',
        module_name: 'ansi-regex'
      },
      'glob-parent': {
        patched_versions: '>=5.1.2',
        vulnerable_versions: '<5.1.2',
        module_name: 'glob-parent'
      },
      'yargs-parser': {
        patched_versions: '>=13.1.2',
        vulnerable_versions: '>=6.0.0 <13.1.2',
        module_name: 'yargs-parser'
      },
      'url-regex': {
        patched_versions: '<0.0.0',
        vulnerable_versions: '<=5.0.0',
        module_name: 'url-regex'
      },
      braces: {
        patched_versions: '>=2.3.1',
        vulnerable_versions: '<2.3.1',
        module_name: 'braces'
      },
      'clean-css': {
        patched_versions: '>=4.1.11',
        vulnerable_versions: '<4.1.11',
        module_name: 'clean-css'
      },
      'json-schema': {
        patched_versions: '>=0.4.0',
        vulnerable_versions: '<0.4.0',
        module_name: 'json-schema'
      }
    })
  })
})
