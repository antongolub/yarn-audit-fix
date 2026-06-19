import {
  matchesId,
  matchesPackage,
  parseIdGlobs,
  parsePackageRules,
} from '../../main/ts/audit/filter'
import { toReport } from '../../main/ts/audit/registry'

describe('audit/filter', () => {
  describe('package rules (--exclude)', () => {
    const match = (spec: string | string[], name: string, version = '0.0.0') =>
      matchesPackage(name, version, parsePackageRules(spec))

    it('matches a plain package name at any version', () => {
      expect(match('lodash', 'lodash', '4.17.21')).toBe(true)
      expect(match('lodash', 'lodash-es', '4.17.21')).toBe(false)
    })

    it('honours an optional version range', () => {
      expect(match('pkg@>=2 <3', 'pkg', '2.5.0')).toBe(true)
      expect(match('pkg@>=2 <3', 'pkg', '1.9.0')).toBe(false)
      expect(match('pkg@>=2 <3', 'pkg', '3.0.0')).toBe(false)
    })

    it('handles scoped names with and without a range', () => {
      expect(match('@scope/pkg', '@scope/pkg', '1.0.0')).toBe(true)
      expect(match('@scope/pkg@>=2 <3', '@scope/pkg', '2.1.0')).toBe(true)
      expect(match('@scope/pkg@>=2 <3', '@scope/pkg', '3.1.0')).toBe(false)
      expect(match('@scope/pkg@>=2 <3', '@scope/other', '2.1.0')).toBe(false)
    })

    it('supports `*` wildcards', () => {
      expect(match('@scope/*', '@scope/anything', '1.0.0')).toBe(true)
      expect(match('eslint-*', 'eslint-plugin-x', '1.0.0')).toBe(true)
      expect(match('eslint-*', 'eslint', '1.0.0')).toBe(false)
    })

    it('parses comma-separated specs and arrays', () => {
      const rules = parsePackageRules('lodash, pkg@^1 , @scope/*')
      expect(rules).toHaveLength(3)
      expect(matchesPackage('@scope/x', '9.9.9', rules)).toBe(true)
      expect(matchesPackage('pkg', '1.2.0', rules)).toBe(true)
      expect(matchesPackage('pkg', '2.0.0', rules)).toBe(false)
      expect(parsePackageRules(['a', 'b,c'])).toHaveLength(3)
    })

    it('treats empty / undefined as no rules', () => {
      expect(parsePackageRules(undefined)).toEqual([])
      expect(parsePackageRules('  ,  ')).toEqual([])
      expect(matchesPackage('x', '1.0.0', [])).toBe(false)
    })

    it('does not match an unparseable version against a ranged rule', () => {
      expect(match('pkg@>=2', 'pkg', 'not-a-version')).toBe(false)
    })

    it('keeps glob metachars literal (dots are not "any char")', () => {
      expect(match('a.b', 'aXb', '1.0.0')).toBe(false)
      expect(match('a.b', 'a.b', '1.0.0')).toBe(true)
    })
  })

  describe('id globs (--ignore)', () => {
    const globs = parseIdGlobs('GHSA-*,1106913')

    it('matches by GHSA and npm advisory id', () => {
      expect(matchesId(['GHSA-aaaa-bbbb-cccc'], globs)).toBe(true)
      expect(matchesId(['1106913'], globs)).toBe(true)
      expect(matchesId(['7654321'], globs)).toBe(false)
      expect(matchesId(['CVE-2021-1234'], globs)).toBe(false)
    })

    it('is empty / false when there are no globs', () => {
      expect(parseIdGlobs(undefined)).toEqual([])
      expect(matchesId(['GHSA-x'], [])).toBe(false)
    })
  })

  describe('toReport honours --ignore (advisory ids)', () => {
    // Shape mirrors the npm bulk endpoint: numeric `id` + GHSA `url`, no `cves`.
    const raw = {
      lodash: [
        {
          id: 1106913,
          url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
          severity: 'high',
          vulnerable_versions: '<4.17.21',
        },
        {
          id: 1106914,
          url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff',
          severity: 'high',
          vulnerable_versions: '<4.17.20',
        },
      ],
    }

    it('drops the GHSA-matched advisory, keeps the rest', () => {
      const kept = toReport(raw, 0, parseIdGlobs('GHSA-aaaa-bbbb-cccc'))
      expect(kept.lodash).toBeDefined()
      expect(kept.lodash.vulnerable_versions).toBe('<4.17.20') // advisory #2 survives
    })

    it('matches by npm advisory id too', () => {
      const kept = toReport(raw, 0, parseIdGlobs('1106913'))
      expect(kept.lodash.vulnerable_versions).toBe('<4.17.20')
    })

    it('drops the package entirely when all its advisories are ignored', () => {
      const out = toReport(raw, 0, parseIdGlobs('GHSA-*'))
      expect(out.lodash).toBeUndefined()
    })

    it('merges both advisories when nothing is ignored', () => {
      const out = toReport(raw, 0)
      expect(out.lodash.vulnerable_versions).toContain('||')
    })
  })
})
