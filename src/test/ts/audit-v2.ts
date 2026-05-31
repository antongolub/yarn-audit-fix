import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAuditReport } from '../../main/ts/audit/v2'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(__dirname, '../fixtures')

describe('parseReport', () => {
  it('processes yarn 2/3 audit report', () => {
    const input = fs.readFileSync(
      path.join(fixtures, 'lockfile/v2/yarn-audit-report.json'),
      'utf-8',
    )

    const report = parseAuditReport(input)

    // Version ranges (projection keeps the assertion readable across 8 advisories).
    const ranges = Object.fromEntries(
      Object.entries(report).map(([k, a]) => [
        k,
        [a.vulnerable_versions, a.patched_versions],
      ]),
    )
    expect(ranges).toEqual({
      'ansi-regex': ['>2.1.1 <5.0.1', '>=5.0.1'],
      immer: ['<9.0.6', '>=9.0.6'],
      'trim-off-newlines': ['<=1.0.1', '<0.0.0'],
      'ansi-html': ['<=0.0.7', '<0.0.0'],
      '@npmcli/git': ['<2.0.8', '>=2.0.8'],
      'glob-parent': ['<5.1.2', '>=5.1.2'],
      browserslist: ['>=4.0.0 <4.16.5', '>=4.16.5'],
      'trim-newlines': ['<3.0.1', '>=3.0.1'],
    })

    // Metadata is threaded through for the upgrade summary.
    expect(report['ansi-regex'].severity).toBe('moderate')
    expect(report['ansi-regex'].refs).toEqual(['CVE-2021-3807', 'GHSA-93q8-gq69-wqmw'])
    expect(report['glob-parent'].severity).toBe('high')
    // immer has two advisories merged → severity escalates to the max (critical).
    expect(report.immer.severity).toBe('critical')
    expect(report.immer.refs).toEqual(
      expect.arrayContaining(['CVE-2021-3757', 'CVE-2021-23436']),
    )
  })
})
