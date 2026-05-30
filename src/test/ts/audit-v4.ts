import * as fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sv from 'semver'

import { derivePatchedVersions, parseAuditReport } from '../../main/ts/audit/v4'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(__dirname, '../fixtures')

describe('parseReport (yarn 4 NDJSON)', () => {
  it('processes yarn 4 audit NDJSON', () => {
    const input = fs.readFileSync(
      join(fixtures, 'lockfile/v4/yarn-audit-report.ndjson'),
      'utf-8',
    )
    // Real yarn 4.6.0 output captured from `yarn npm audit --all --json --recursive`
    // against a fixture with lodash@4.17.20 and minimist@1.2.5.
    const result = parseAuditReport(input)
    expect(Object.keys(result).sort()).toEqual(['lodash', 'minimist'])
    expect(result.lodash.module_name).toBe('lodash')
    expect(result.minimist).toEqual({
      module_name: 'minimist',
      vulnerable_versions: '>=1.0.0 <1.2.6',
      patched_versions: '>=1.2.6',
    })
    // 5 lodash advisories merge as ORed patched ranges → minVersion is the
    // lowest installable fix that addresses *any* advisory (4.17.21, the
    // actual latest published — even though some advisories report
    // unreleased fixes >4.17.23).
    expect(sv.minVersion(result.lodash.patched_versions)?.format()).toBe('4.17.21')
  })
})

describe('derivePatchedVersions', () => {
  it.each([
    ['<4.17.21',             '>=4.17.21'],
    ['>=4.0.0 <4.17.21',     '>=4.17.21'],
    ['>=4.0.0 <=4.17.22',    '>4.17.22'],
    ['<=4.17.23',            '>4.17.23'],
    ['>=1.0.0 <1.2.6',       '>=1.2.6'],
    // Unbounded → no patched version expressible → "no fix" sentinel.
    ['>=1.0.0',              '<0.0.0'],
    ['*',                    '<0.0.0'],
  ])('%s → %s', (vuln, expected) => {
    expect(derivePatchedVersions(vuln)).toBe(expected)
  })
})
