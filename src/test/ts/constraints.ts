import sv from 'semver'
import { describe, expect, it, vi } from 'vitest'

import {
  buildConstraints,
  describeEngineTargets,
  resolveEngineTargets,
} from '../../main/ts/audit/constraints'
import { format, parse, patch } from '../../main/ts/lockfile'

// ─── unit: resolveEngineTargets ─────────────────────────────────────────────
describe('resolveEngineTargets', () => {
  it('returns undefined when nothing is set', () => {
    expect(resolveEngineTargets(undefined)).toBeUndefined()
    expect(resolveEngineTargets({})).toBeUndefined()
    expect(resolveEngineTargets('nope')).toBeUndefined()
    expect(resolveEngineTargets(['>=18'])).toBeUndefined() // arrays rejected
  })

  it('passes an explicit range through verbatim', () => {
    expect(resolveEngineTargets({ node: '>=18' })).toEqual({ node: '>=18' })
    expect(resolveEngineTargets({ node: '>=18', npm: '>=9' })).toEqual({
      node: '>=18',
      npm: '>=9',
    })
  })

  it('resolves bare (true) / "runtime" to the running version floor', () => {
    const expected = `>=${process.versions.node}`
    expect(resolveEngineTargets({ node: true })).toEqual({ node: expected })
    expect(resolveEngineTargets({ node: 'runtime' })).toEqual({ node: expected })
  })

  it('throws on an invalid range', () => {
    expect(() => resolveEngineTargets({ node: 'garbage!!' })).toThrow(
      /not a valid semver range/,
    )
  })

  it('throws on the not-yet-supported "floor" keyword', () => {
    expect(() => resolveEngineTargets({ node: 'floor' })).toThrow(
      /floor is not supported yet/,
    )
  })

  it('throws when a runtime version cannot be inferred (e.g. npm bare)', () => {
    expect(() => resolveEngineTargets({ npm: true })).toThrow(
      /no runtime version to infer/,
    )
  })

  it('guards against prototype-pollution keys and non-identifier keys', () => {
    // JSON.parse makes `__proto__` an OWN enumerable key (unlike a literal).
    const raw = JSON.parse('{"__proto__": ">=1", "node": ">=18"}')
    expect(resolveEngineTargets(raw)).toEqual({ node: '>=18' })
    expect(({} as any).polluted).toBeUndefined()
    // a non-identifier key is dropped, the valid one kept
    expect(resolveEngineTargets({ 'has space': '>=1', node: '>=18' })).toEqual({
      node: '>=18',
    })
  })
})

describe('describeEngineTargets / buildConstraints', () => {
  it('renders a readable summary', () => {
    expect(describeEngineTargets({ node: '>=18', npm: '>=9' })).toBe(
      'node >=18, npm >=9',
    )
  })

  it('builds an engines condition, or nothing when unset', () => {
    expect(buildConstraints(undefined)).toEqual([])
    const c = buildConstraints({ node: '>=18' })
    expect(c).toHaveLength(1)
    expect(c[0].kind).toBe('engines')
  })
})

// ─── integration: the engine gate in patch() ────────────────────────────────
// Canned offline registry. Two independent vulns:
//   goodv 1.0.0 → 2.0.0  (clean fix, no new engine-bad deps)
//   badv  1.0.0 → 2.0.0  (fix pulls newdep@^1.0.0)
//   newdep 1.0.0         (engines.node '>=20' — incompatible with a >=18 target)
const spec: Record<string, Record<string, any>> = {
  goodv: { '1.0.0': {}, '2.0.0': {} },
  badv: { '1.0.0': {}, '2.0.0': { deps: { newdep: '^1.0.0' } } },
  newdep: { '1.0.0': { engines: { node: '>=20' } } },
}
const versionOf = (name: string, v: string) => ({
  name,
  version: v,
  dependencies: spec[name][v].deps ?? {},
  engines: spec[name][v].engines,
  dist: {
    tarball: `https://registry.npmjs.org/${name}/-/${name}-${v}.tgz`,
    shasum: '0'.repeat(40),
    integrity: 'sha512-AA==',
  },
})
const registry = {
  packument: async (name: string) =>
    spec[name]
      ? {
          name,
          distTags: { latest: Object.keys(spec[name]).sort().at(-1) },
          versions: Object.fromEntries(
            Object.keys(spec[name]).map((v) => [v, versionOf(name, v)]),
          ),
        }
      : undefined,
  resolve: async (name: string, range: string) => {
    const v = Object.keys(spec[name] ?? {})
      .reverse()
      .find((x) => sv.satisfies(x, range))
    return v ? versionOf(name, v) : undefined
  },
} as any

const report = {
  goodv: {
    module_name: 'goodv', // eslint-disable-line camelcase
    vulnerable_versions: '<2.0.0', // eslint-disable-line camelcase
    patched_versions: '>=2.0.0', // eslint-disable-line camelcase
  },
  badv: {
    module_name: 'badv', // eslint-disable-line camelcase
    vulnerable_versions: '<2.0.0', // eslint-disable-line camelcase
    patched_versions: '>=2.0.0', // eslint-disable-line camelcase
  },
}

const lock =
  '# yarn lockfile v1\n\n\n' +
  'goodv@^1.0.0:\n  version "1.0.0"\n' +
  '  resolved "https://registry.yarnpkg.com/goodv/-/goodv-1.0.0.tgz#' +
  '1111111111111111111111111111111111111111"\n  integrity sha512-AA==\n\n' +
  'badv@^1.0.0:\n  version "1.0.0"\n' +
  '  resolved "https://registry.yarnpkg.com/badv/-/badv-1.0.0.tgz#' +
  '2222222222222222222222222222222222222222"\n  integrity sha512-BB==\n'

const ctxWith = (flags: Record<string, any>): any => ({
  flags: { silent: true, ...flags },
  registry,
  cwd: process.cwd(),
  manifest: {},
})

describe('engine constraints — patch integration', () => {
  it('no constraint: both vulns fixed, newdep pulled into the closure', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(await patch(parse(lock, fmt), report, ctxWith({}), fmt), fmt)
    expect(out).toContain('goodv@2.0.0') // fixed
    expect(out).toMatch(/badv@2\.0\.0/) // fixed
    expect(out).toContain('newdep') // closure completed (no gate)
  })

  it('--engines.node >=18: skips the fix whose closure needs node>=20, keeps the clean one', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(
      await patch(parse(lock, fmt), report, ctxWith({ engines: { node: '>=18' } }), fmt),
      fmt,
    )
    expect(out).toContain('goodv@2.0.0') // clean fix still applied
    expect(out).toMatch(/badv@1\.0\.0|badv@\^1\.0\.0/) // badv left vulnerable (skipped)
    expect(out).not.toMatch(/badv@2\.0\.0/) // not bumped
    expect(out).not.toContain('newdep') // engine-bad transitive never wired
  })

  it('--engines.node compatible target: applies the fix (newdep passes)', async () => {
    const fmt = 'yarn-classic' as const
    // target >=20 admits newdep's engines.node >=20, so badv's fix completes
    const out = format(
      await patch(parse(lock, fmt), report, ctxWith({ engines: { node: '>=20' } }), fmt),
      fmt,
    )
    expect(out).toMatch(/badv@2\.0\.0/) // fix applied
    expect(out).toContain('newdep') // closure completed
  })

  it('--on-conflict=stop: throws instead of skipping', async () => {
    const fmt = 'yarn-classic' as const
    await expect(
      patch(
        parse(lock, fmt),
        report,
        ctxWith({ engines: { node: '>=18' }, 'on-conflict': 'stop' }),
        fmt,
      ),
    ).rejects.toThrow(/no in-range version of newdep/)
  })

  // §8.1 attribution contract: the log MUST show a fix was skipped *because of a
  // constraint*, naming the axis + the blocking transitive.
  it('reports the skip attributed to the engine constraint', async () => {
    const fmt = 'yarn-classic' as const
    const lines: string[] = []
    const sink = (...a: unknown[]) => void lines.push(a.join(' '))
    const log = vi.spyOn(console, 'log').mockImplementation(sink)
    const warn = vi.spyOn(console, 'warn').mockImplementation(sink)
    try {
      await patch(
        parse(lock, fmt),
        report,
        ctxWith({ engines: { node: '>=18' }, silent: false, verbose: true }),
        fmt,
      )
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    const text = lines.join('\n')
    expect(text).toContain('Engine constraints: node >=18')
    expect(text).toMatch(/Skipped \(engine constraints/)
    expect(text).toContain('badv@1.0.0 → 2.0.0') // the skipped fix
    expect(text).toContain('needs newdep@^1.0.0') // attributed to the transitive
    expect(text).toMatch(/newdep@1\.0\.0:.*(>=20|engines)/) // verbose why-rejected
  })
})
