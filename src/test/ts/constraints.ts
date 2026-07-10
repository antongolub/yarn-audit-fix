import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sv from 'semver'
import { describe, expect, it, vi } from 'vitest'

import {
  buildConstraints,
  describeConstraints,
  describeEngineTargets,
  describeLicensePolicy,
  resolveEngineTargets,
  resolveLicensePolicy,
  resolvePackageType,
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

describe('resolveEngineTargets — floor (infer from the tree)', () => {
  // Build a throwaway project: root engines + node_modules/<dep>/package.json each.
  const mkTree = (
    rootEngines: Record<string, string> | undefined,
    deps: Record<string, Record<string, string> | undefined>,
  ): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaf-floor-'))
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'root', ...(rootEngines ? { engines: rootEngines } : {}) }),
    )
    const nm = path.join(dir, 'node_modules')
    fs.mkdirSync(nm)
    for (const [name, engines] of Object.entries(deps)) {
      const pd = path.join(nm, name)
      fs.mkdirSync(pd, { recursive: true })
      fs.writeFileSync(
        path.join(pd, 'package.json'),
        JSON.stringify({ name, ...(engines ? { engines } : {}) }),
      )
    }
    return dir
  }

  it('takes the highest engine lower-bound across root + node_modules', () => {
    const dir = mkTree({ node: '>=14' }, { a: { node: '>=16' }, b: { node: '^18.0.0' }, c: undefined })
    expect(resolveEngineTargets({ node: 'floor' }, dir)).toEqual({ node: '>=18.0.0' })
  })

  it('works from the root manifest alone when node_modules is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaf-floor-'))
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=20' } }))
    expect(resolveEngineTargets({ node: 'floor' }, dir)).toEqual({ node: '>=20.0.0' })
  })

  it('reads a scoped dependency', () => {
    const dir = mkTree(undefined, {})
    const scoped = path.join(dir, 'node_modules', '@scope', 'x')
    fs.mkdirSync(scoped, { recursive: true })
    fs.writeFileSync(path.join(scoped, 'package.json'), JSON.stringify({ engines: { node: '>=19' } }))
    expect(resolveEngineTargets({ node: 'floor' }, dir)).toEqual({ node: '>=19.0.0' })
  })

  it('includes workspace manifests (monorepo), no node_modules needed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaf-floor-'))
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'], engines: { node: '>=16' } }),
    )
    const ws = path.join(dir, 'packages', 'foo')
    fs.mkdirSync(ws, { recursive: true })
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ engines: { node: '>=22' } }))
    // the workspace's >=22 raises the floor above the root's >=16
    expect(resolveEngineTargets({ node: 'floor' }, dir)).toEqual({ node: '>=22.0.0' })
  })

  it('throws when nothing declares the engine', () => {
    const dir = mkTree(undefined, { a: undefined })
    expect(() => resolveEngineTargets({ node: 'floor' }, dir)).toThrow(
      /nothing in the project declares engines.node/,
    )
  })

  it('throws without a project dir', () => {
    expect(() => resolveEngineTargets({ node: 'floor' })).toThrow(/needs the project dir/)
  })
})

describe('describeEngineTargets / buildConstraints', () => {
  it('renders a readable summary', () => {
    expect(describeEngineTargets({ node: '>=18', npm: '>=9' })).toBe(
      'node >=18, npm >=9',
    )
  })

  it('builds engines + license + package-type conditions, or nothing when unset', () => {
    expect(buildConstraints(undefined, undefined)).toEqual([])
    expect(buildConstraints({ node: '>=18' }).map((c) => c.kind)).toEqual([
      'engines',
    ])
    expect(
      buildConstraints({ node: '>=18' }, { allow: ['MIT'] }).map((c) => c.kind),
    ).toEqual(['engines', 'license'])
    expect(
      buildConstraints(undefined, { deny: ['GPL-3.0'] }).map((c) => c.kind),
    ).toEqual(['license'])
    // package-type adds a commonjs gate, ordered after the cheaper axes
    expect(
      buildConstraints({ node: '>=18' }, { allow: ['MIT'] }, 'cjs').map((c) => c.kind),
    ).toEqual(['engines', 'license', 'commonjs'])
    expect(buildConstraints(undefined, undefined, 'cjs').map((c) => c.kind)).toEqual([
      'commonjs',
    ])
  })
})

describe('resolvePackageType', () => {
  it('accepts cjs, ignores unset, rejects the unsupported', () => {
    expect(resolvePackageType('cjs')).toBe('cjs')
    expect(resolvePackageType(undefined)).toBeUndefined()
    expect(resolvePackageType(false)).toBeUndefined()
    expect(resolvePackageType('')).toBeUndefined()
    expect(() => resolvePackageType('esm')).toThrow(/not supported/)
  })
})

describe('resolveLicensePolicy / describeLicensePolicy / describeConstraints', () => {
  it('returns undefined when nothing is set', () => {
    expect(resolveLicensePolicy(undefined)).toBeUndefined()
    expect(resolveLicensePolicy(false)).toBeUndefined()
    expect(resolveLicensePolicy('')).toBeUndefined()
    expect(resolveLicensePolicy({})).toBeUndefined()
  })

  it('parses a bare allow list and the dot form', () => {
    expect(resolveLicensePolicy('MIT, ISC ,Apache-2.0')).toEqual({
      allow: ['MIT', 'ISC', 'Apache-2.0'],
    })
    expect(resolveLicensePolicy({ allow: 'MIT,ISC', deny: 'GPL-3.0' })).toEqual({
      allow: ['MIT', 'ISC'],
      deny: ['GPL-3.0'],
    })
    // minimist collects a repeated flag into an array
    expect(resolveLicensePolicy({ allow: ['MIT', 'ISC'] })).toEqual({
      allow: ['MIT', 'ISC'],
    })
  })

  it('renders policy + combined summaries', () => {
    expect(
      describeLicensePolicy({ allow: ['MIT', 'ISC'], deny: ['GPL-3.0'] }),
    ).toBe('allow MIT, ISC / deny GPL-3.0')
    expect(describeConstraints({ node: '>=18' }, { allow: ['MIT'] })).toBe(
      'node >=18; license allow MIT',
    )
    expect(describeConstraints(undefined, { deny: ['GPL-3.0'] })).toBe(
      'license deny GPL-3.0',
    )
    expect(describeConstraints({ node: '>=18' }, undefined)).toBe('node >=18')
    expect(describeConstraints({ node: '>=18' }, undefined, 'cjs')).toBe(
      'node >=18; commonjs-compatible',
    )
    expect(describeConstraints(undefined, undefined, 'cjs')).toBe('commonjs-compatible')
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
  // a fix whose OWN engines exceed the target (no bad transitive) — seed gate
  engselfv: { '1.0.0': {}, '2.0.0': { engines: { node: '>=20' } } },
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
    expect(text).toContain('Constraints: node >=18')
    expect(text).toMatch(/Skipped \(constraints/)
    expect(text).toContain('badv@1.0.0 → 2.0.0') // the skipped fix
    expect(text).toContain('needs newdep@^1.0.0') // attributed to the transitive
    expect(text).toMatch(/newdep@1\.0\.0:.*(>=20|engines)/) // verbose why-rejected
  })

  // seed gate: the fix VERSION's own engines are checked, not only its closure
  it('seed gate: skips a fix whose own engines exceed the target', async () => {
    const fmt = 'yarn-classic' as const
    const seedLock =
      '# yarn lockfile v1\n\n\nengselfv@^1.0.0:\n  version "1.0.0"\n' +
      '  resolved "https://registry.yarnpkg.com/engselfv/-/engselfv-1.0.0.tgz#' +
      '4444444444444444444444444444444444444444"\n  integrity sha512-AA==\n'
    const seedReport = {
      engselfv: {
        module_name: 'engselfv', // eslint-disable-line camelcase
        vulnerable_versions: '<2.0.0', // eslint-disable-line camelcase
        patched_versions: '>=2.0.0', // eslint-disable-line camelcase
      },
    }
    const out = format(
      await patch(parse(seedLock, fmt), seedReport, ctxWith({ engines: { node: '>=18' } }), fmt),
      fmt,
    )
    expect(out).toContain('version "1.0.0"') // NOT bumped — fix itself needs node>=20
    expect(out).not.toMatch(/engselfv@2\.0\.0/)
  })
})

// ─── integration: the license gate in patch() ───────────────────────────────
// Same goodv/badv lock, but badv's fix pulls a GPL transitive. corgi (packument/
// resolve) omits `license`; only the full manifest() carries it — exactly the
// split the license gate relies on (and the reason buildRegistry forwards it).
const licSpec: Record<string, Record<string, any>> = {
  goodv: { '1.0.0': { license: 'MIT' }, '2.0.0': { license: 'MIT' } },
  badv: {
    '1.0.0': { license: 'MIT' },
    '2.0.0': { license: 'MIT', deps: { gpldep: '^1.0.0' } },
  },
  gpldep: { '1.0.0': { license: 'GPL-3.0' } },
  // a fix whose OWN license is forbidden (no bad transitive) — for the seed gate
  gplself: { '1.0.0': { license: 'MIT' }, '2.0.0': { license: 'GPL-3.0' } },
  // a fix that pulls an ESM-only transitive — for the package-type gate
  esmv: { '1.0.0': { license: 'MIT' }, '2.0.0': { license: 'MIT', deps: { esmdep: '^1.0.0' } } },
  esmdep: { '1.0.0': { license: 'MIT', type: 'module' } }, // ESM-only: type:module, no main/exports
}
// `full` = the manifest() view: the fields corgi omits (license, type, main, exports).
const licVersion = (name: string, v: string, full: boolean) => {
  const s = licSpec[name][v]
  return {
    name,
    version: v,
    dependencies: s.deps ?? {},
    ...(full
      ? { license: s.license, type: s.type, main: s.main, exports: s.exports }
      : {}),
    dist: {
      tarball: `https://registry.npmjs.org/${name}/-/${name}-${v}.tgz`,
      shasum: '0'.repeat(40),
      integrity: 'sha512-AA==',
    },
  }
}
const licRegistry = {
  packument: async (name: string) =>
    licSpec[name]
      ? {
          name,
          distTags: { latest: Object.keys(licSpec[name]).sort().at(-1) },
          // corgi carries NO license field
          versions: Object.fromEntries(
            Object.keys(licSpec[name]).map((v) => [v, licVersion(name, v, false)]),
          ),
        }
      : undefined,
  resolve: async (name: string, range: string) => {
    const v = Object.keys(licSpec[name] ?? {})
      .reverse()
      .find((x) => sv.satisfies(x, range))
    return v ? licVersion(name, v, false) : undefined
  },
  // full manifest DOES carry license — the field corgi omits
  manifest: async (name: string, version: string) =>
    licSpec[name]?.[version] ? licVersion(name, version, true) : undefined,
} as any

const ctxLic = (flags: Record<string, any>): any => ({
  flags: { silent: true, ...flags },
  registry: licRegistry,
  cwd: process.cwd(),
  manifest: {},
})

describe('license constraints — patch integration', () => {
  it('no policy: both fixed, the GPL transitive pulled without a gate', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(await patch(parse(lock, fmt), report, ctxLic({}), fmt), fmt)
    expect(out).toMatch(/badv@2\.0\.0/)
    expect(out).toContain('gpldep') // closure completed (no gate)
  })

  it('--license.allow: skips the fix whose closure pulls a non-allowed license', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(
      await patch(parse(lock, fmt), report, ctxLic({ license: { allow: ['MIT', 'ISC'] } }), fmt),
      fmt,
    )
    expect(out).toContain('goodv@2.0.0') // MIT closure — applied
    expect(out).toMatch(/badv@1\.0\.0|badv@\^1\.0\.0/) // GPL closure — skipped
    expect(out).not.toMatch(/badv@2\.0\.0/)
    expect(out).not.toContain('gpldep') // denied transitive never wired
  })

  it('--license.deny: same skip via a deny list', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(
      await patch(parse(lock, fmt), report, ctxLic({ license: { deny: ['GPL-3.0'] } }), fmt),
      fmt,
    )
    expect(out).not.toMatch(/badv@2\.0\.0/) // GPL denied → skipped
    expect(out).toContain('goodv@2.0.0')
  })

  it('--on-conflict=stop: a denied license throws', async () => {
    const fmt = 'yarn-classic' as const
    await expect(
      patch(
        parse(lock, fmt),
        report,
        ctxLic({ license: { deny: ['GPL-3.0'] }, 'on-conflict': 'stop' }),
        fmt,
      ),
    ).rejects.toThrow(/no in-range version of gpldep/)
  })

  // seed gate: the fix VERSION's own license is checked, not only its closure
  it('seed gate: skips a fix whose own license is denied', async () => {
    const fmt = 'yarn-classic' as const
    const seedLock =
      '# yarn lockfile v1\n\n\ngplself@^1.0.0:\n  version "1.0.0"\n' +
      '  resolved "https://registry.yarnpkg.com/gplself/-/gplself-1.0.0.tgz#' +
      '3333333333333333333333333333333333333333"\n  integrity sha512-AA==\n'
    const seedReport = {
      gplself: {
        module_name: 'gplself', // eslint-disable-line camelcase
        vulnerable_versions: '<2.0.0', // eslint-disable-line camelcase
        patched_versions: '>=2.0.0', // eslint-disable-line camelcase
      },
    }
    const lines: string[] = []
    const sink = (...a: unknown[]) => void lines.push(a.join(' '))
    const log = vi.spyOn(console, 'log').mockImplementation(sink)
    const warn = vi.spyOn(console, 'warn').mockImplementation(sink)
    let out = ''
    try {
      out = format(
        await patch(
          parse(seedLock, fmt),
          seedReport,
          ctxLic({ license: { deny: ['GPL-3.0'] }, silent: false, verbose: true }),
          fmt,
        ),
        fmt,
      )
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    expect(out).toContain('version "1.0.0"') // NOT bumped — the fix itself is GPL
    expect(out).not.toMatch(/gplself@2\.0\.0/)
    const text = lines.join('\n')
    expect(text).toContain('the fix version itself is not permitted')
    expect(text).toMatch(/gplself@2\.0\.0: license GPL-3\.0/)
  })

  it('seed gate + --on-conflict=stop: a denied fix version throws', async () => {
    const fmt = 'yarn-classic' as const
    const seedLock =
      '# yarn lockfile v1\n\n\ngplself@^1.0.0:\n  version "1.0.0"\n' +
      '  resolved "https://registry.yarnpkg.com/gplself/-/gplself-1.0.0.tgz#' +
      '3333333333333333333333333333333333333333"\n  integrity sha512-AA==\n'
    const seedReport = {
      gplself: {
        module_name: 'gplself', // eslint-disable-line camelcase
        vulnerable_versions: '<2.0.0', // eslint-disable-line camelcase
        patched_versions: '>=2.0.0', // eslint-disable-line camelcase
      },
    }
    await expect(
      patch(
        parse(seedLock, fmt),
        seedReport,
        ctxLic({ license: { deny: ['GPL-3.0'] }, 'on-conflict': 'stop' }),
        fmt,
      ),
    ).rejects.toThrow(/the fix gplself.* itself doesn't satisfy the policy/)
  })
})

// ─── integration: the package-format gate in patch() ────────────────────────
// esmv's fix pulls esmdep, which is ESM-only (type: module, no CJS entry). corgi
// omits `type`; the full manifest() carries it — the split the gate relies on.
const esmLock =
  '# yarn lockfile v1\n\n\nesmv@^1.0.0:\n  version "1.0.0"\n' +
  '  resolved "https://registry.yarnpkg.com/esmv/-/esmv-1.0.0.tgz#' +
  '5555555555555555555555555555555555555555"\n  integrity sha512-AA==\n'
const esmReport = {
  esmv: {
    module_name: 'esmv', // eslint-disable-line camelcase
    vulnerable_versions: '<2.0.0', // eslint-disable-line camelcase
    patched_versions: '>=2.0.0', // eslint-disable-line camelcase
  },
}

describe('package-type constraint — patch integration', () => {
  it('no package-type: the ESM-only dep is pulled without a gate', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(await patch(parse(esmLock, fmt), esmReport, ctxLic({}), fmt), fmt)
    expect(out).toMatch(/esmv@2\.0\.0/) // fixed
    expect(out).toContain('esmdep') // ESM-only transitive pulled, no gate
  })

  it('--package-type=cjs: skips a fix whose closure pulls an ESM-only dep', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(
      await patch(parse(esmLock, fmt), esmReport, ctxLic({ 'package-type': 'cjs' }), fmt),
      fmt,
    )
    expect(out).toMatch(/esmv@1\.0\.0|esmv@\^1\.0\.0/) // left vulnerable (skipped)
    expect(out).not.toMatch(/esmv@2\.0\.0/)
    expect(out).not.toContain('esmdep') // the ESM-only dep never wired
  })

  it('--package-type=cjs attributes the skip to the ESM-only dep', async () => {
    const fmt = 'yarn-classic' as const
    const lines: string[] = []
    const sink = (...a: unknown[]) => void lines.push(a.join(' '))
    const log = vi.spyOn(console, 'log').mockImplementation(sink)
    const warn = vi.spyOn(console, 'warn').mockImplementation(sink)
    try {
      await patch(
        parse(esmLock, fmt),
        esmReport,
        ctxLic({ 'package-type': 'cjs', silent: false, verbose: true }),
        fmt,
      )
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    const text = lines.join('\n')
    expect(text).toContain('Constraints: commonjs-compatible')
    expect(text).toMatch(/esmdep@1\.0\.0: esmdep@1\.0\.0 is ESM-only/)
  })
})

// ─── integration: the --safe bundle in patch() ──────────────────────────────
describe('--safe bundle — patch integration', () => {
  const safeCtx = (root: Record<string, any>, flags: Record<string, any> = {}) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yaf-safe-'))
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(root))
    return { ...ctxLic({ safe: true, ...flags }), cwd, manifest: root }
  }

  it('CommonJS project: bundles engine-floor + package-type=cjs, skips an ESM-only fix', async () => {
    const fmt = 'yarn-classic' as const
    const lines: string[] = []
    const sink = (...a: unknown[]) => void lines.push(a.join(' '))
    const log = vi.spyOn(console, 'log').mockImplementation(sink)
    const warn = vi.spyOn(console, 'warn').mockImplementation(sink)
    let out = ''
    try {
      out = format(
        await patch(
          parse(esmLock, fmt),
          esmReport,
          safeCtx({ engines: { node: '>=18' } }, { silent: false }),
          fmt,
        ),
        fmt,
      )
    } finally {
      log.mockRestore()
      warn.mockRestore()
    }
    // --safe filled BOTH axes: the tree's engine floor + commonjs-compatibility
    expect(lines.join('\n')).toContain(
      'Constraints (--safe): node >=18.0.0; commonjs-compatible',
    )
    expect(out).not.toMatch(/esmv@2\.0\.0/) // ESM-only closure → skipped
  })

  it('ESM project (type: module): does NOT force package-type=cjs', async () => {
    const fmt = 'yarn-classic' as const
    const out = format(
      await patch(parse(esmLock, fmt), esmReport, safeCtx({ type: 'module' }), fmt),
      fmt,
    )
    expect(out).toMatch(/esmv@2\.0\.0/) // ESM root can consume ESM → fixed
  })

  it('--safe and --force are mutually exclusive', async () => {
    const fmt = 'yarn-classic' as const
    await expect(
      patch(parse(esmLock, fmt), esmReport, ctxLic({ safe: true, force: true }), fmt),
    ).rejects.toThrow(/--safe and --force are opposites/)
  })
})
