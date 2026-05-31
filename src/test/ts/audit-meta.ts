import {
  extractRefs,
  formatAdvisoryMeta,
  maxSeverity,
  mergeMeta,
} from '../../main/ts/audit/meta'
import { TAuditAdvisory } from '../../main/ts/ifaces'

describe('maxSeverity', () => {
  it.each([
    ['low', 'high', 'high'],
    ['critical', 'moderate', 'critical'],
    [undefined, 'low', 'low'],
    ['moderate', undefined, 'moderate'],
    [undefined, undefined, undefined],
  ])('%s + %s = %s', (a, b, expected) => {
    expect(maxSeverity(a, b)).toBe(expected)
  })
})

describe('extractRefs', () => {
  it('collects explicit cves plus CVE/GHSA mined from free text', () => {
    // Order: explicit cves first, then CVEs mined from text, then GHSAs.
    expect(
      extractRefs(
        ['CVE-2021-23368'],
        'see https://github.com/advisories/GHSA-hwj9-h5mp-3pm3',
        'also CVE-2020-8203 applies',
      ),
    ).toEqual(['CVE-2021-23368', 'CVE-2020-8203', 'GHSA-hwj9-h5mp-3pm3'])
  })

  it('dedupes and tolerates empty input', () => {
    expect(extractRefs(undefined)).toEqual([])
    expect(extractRefs(['CVE-2021-1'], 'CVE-2021-1')).toEqual(['CVE-2021-1'])
  })
})

describe('mergeMeta', () => {
  it('takes max severity, max cvss, unions refs', () => {
    const a = { severity: 'moderate', cvss: 5.3, refs: ['CVE-1'] } as TAuditAdvisory
    const b = { severity: 'critical', cvss: 9.1, refs: ['CVE-2'] } as TAuditAdvisory
    expect(mergeMeta(a, b)).toEqual({
      severity: 'critical',
      cvss: 9.1,
      refs: ['CVE-1', 'CVE-2'],
      url: undefined,
    })
  })
})

describe('formatAdvisoryMeta', () => {
  it('renders severity, CVSS and refs', () => {
    expect(
      formatAdvisoryMeta({
        severity: 'high',
        cvss: 7.5,
        refs: ['CVE-2021-23337'],
      } as TAuditAdvisory),
    ).toBe('  [high, CVSS 7.5] CVE-2021-23337')
  })

  it('omits the badge when only refs are known (yarn 4 sans cvss)', () => {
    expect(
      formatAdvisoryMeta({
        severity: 'critical',
        refs: ['GHSA-xvch-5gv4-984h'],
      } as TAuditAdvisory),
    ).toBe('  [critical] GHSA-xvch-5gv4-984h')
  })

  it('returns empty string when nothing is known', () => {
    expect(formatAdvisoryMeta(undefined)).toBe('')
    expect(formatAdvisoryMeta({} as TAuditAdvisory)).toBe('')
  })

  it('suppresses the npm "unscored" CVSS 0 placeholder', () => {
    // form-data ships severity=critical, cvss.score=0 — never render "CVSS 0".
    expect(
      formatAdvisoryMeta({
        severity: 'critical',
        cvss: 0,
        refs: ['CVE-2025-7783'],
      } as TAuditAdvisory),
    ).toBe('  [critical] CVE-2025-7783')
  })
})
