import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sv from 'semver'

import { derivePatchedVersions, parseAuditReport } from '../../main/ts/audit/v4'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(__dirname, '../fixtures')

describe('parseReport (yarn 4 NDJSON)', () => {
  it('processes yarn 4 audit NDJSON', () => {
    const input = fs.readFileSync(
      path.join(fixtures, 'lockfile/v4/yarn-audit-report.ndjson'),
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
    // 5 lodash advisories AND-merge: a fix must clear *all* of them. The
    // strictest is `<=4.17.23` → patched `>4.17.23`, so only versions above
    // 4.17.23 are safe. (The resulting floor 4.17.24 was never published —
    // the patch step snaps it to the real next release, 4.18.0, via the
    // registry; see lockfile.ts `_patch`.)
    expect(sv.satisfies('4.18.0', result.lodash.patched_versions)).toBe(true)
    expect(sv.satisfies('4.17.23', result.lodash.patched_versions)).toBe(false)
    expect(sv.satisfies('4.17.21', result.lodash.patched_versions)).toBe(false)
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
