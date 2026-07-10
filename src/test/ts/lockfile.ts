import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sv from 'semver'

import { TAuditReport, TContext } from '../../main/ts/ifaces'
import {
  format,
  getLockfileType,
  overridesOf,
  parse,
  patch,
  refurbish,
} from '../../main/ts/lockfile'
import { applyManifestEdit } from '../../main/ts/util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---- helpers ----------------------------------------------------------------

// name -> version -> {dep: range}
type Spec = Record<string, Record<string, Record<string, string>>>

// A minimal `@antongolub/lockfile` RegistryAdapter backed by a canned spec, so
// the patch flow (replaceVersion + completeTransitives) stays offline + hermetic.
const mockRegistry = (spec: Spec) =>
  ({
    packument: async (name: string) => {
      const versions = spec[name]
      if (!versions) return undefined
      return {
        name,
        distTags: { latest: Object.keys(versions).sort(sv.compare).at(-1)! },
        versions: Object.fromEntries(
          Object.entries(versions).map(([v, dependencies]) => [
            v,
            { name, version: v, dependencies },
          ]),
        ),
      }
    },
    resolve: async (name: string, range: string) => {
      const versions = spec[name]
      if (!versions) return undefined
      const match = versions[range]
        ? range
        : Object.keys(versions)
            .filter((v) => sv.satisfies(v, range))
            .sort(sv.compare)
            .at(-1)
      return match
        ? { name, version: match, dependencies: versions[match] }
        : undefined
    },
  }) as any

// Build a minimal yarn-classic lockfile. `entries[].id` is the descriptor key
// (e.g. `glob@^10.0.0`); `version` the resolved version; `deps` the declared deps.
const B64 = 'A'.repeat(86) + '=='
const lock = (
  entries: { id: string; version: string; deps?: Record<string, string> }[],
): string =>
  '# yarn lockfile v1\n\n\n' +
  entries
    .map((e) => {
      const deps =
        e.deps && Object.keys(e.deps).length > 0
          ? '\n  dependencies:\n' +
            Object.entries(e.deps)
              .map(([n, r]) => `    "${n}" "${r}"`)
              .join('\n')
          : ''
      return (
        `"${e.id}":\n` +
        `  version "${e.version}"\n` +
        `  resolved "https://registry.yarnpkg.com/x/-/x-${e.version}.tgz#${e.version.replace(/\W/g, '')}"\n` +
        `  integrity sha512-${B64}${deps}`
      )
    })
    .join('\n\n') +
  '\n'

const ctx = (flags: Record<string, any>, registry: any): TContext =>
  ({ flags, registry, cwd: process.cwd() }) as unknown as TContext

const run = async (
  lockfile: string,
  report: TAuditReport,
  flags: Record<string, any>,
  spec: Spec,
): Promise<string> => {
  const fmt = getLockfileType(lockfile)
  const graph = parse(lockfile, fmt)
  const patched = await patch(graph, report, ctx(flags, mockRegistry(spec)), fmt)
  return format(patched, fmt)
}

const advisory = (vulnerable: string, patched: string) => ({
  module_name: 'x',
  vulnerable_versions: vulnerable,
  patched_versions: patched,
})

// ---- tests ------------------------------------------------------------------

describe('patch', () => {
  it('bumps a vulnerable package to the lowest published fix', async () => {
    const out = await run(
      lock([{ id: 'lodash@^4.17.0', version: '4.17.20' }]),
      { lodash: advisory('<4.17.21', '>=4.17.21') },
      { silent: true },
      { lodash: { '4.17.20': {}, '4.17.21': {}, '4.17.22': {} } },
    )
    expect(out).toContain('version "4.17.21"') // lowest satisfying, not latest
    expect(out).not.toContain('version "4.17.22"')
  })

  it('completes the new transitive closure of an upgraded package', async () => {
    const out = await run(
      lock([{ id: 'vuln@^1.0.0', version: '1.0.0' }]),
      { vuln: advisory('<2.0.0', '>=2.0.0') },
      { silent: true },
      {
        vuln: { '1.0.0': {}, '2.0.0': { 'new-dep': '^1.0.0' } },
        'new-dep': { '1.0.0': { 'deep-dep': '^1.0.0' } },
        'deep-dep': { '1.0.0': {} },
      },
    )
    expect(out).toContain('version "2.0.0"') // vuln bumped
    expect(out).toContain('new-dep@') // direct new dep pulled in
    expect(out).toContain('deep-dep@') // transitive new dep pulled in
  })

  it('honors a declared resolutions pin when completing a new transitive (verbatim, even out of range)', async () => {
    const spec = {
      vuln: { '1.0.0': {}, '2.0.0': { 'new-dep': '^1.0.0' } },
      'new-dep': { '1.0.0': {}, '1.5.0': {}, '2.0.0': {} },
    }
    const report = { vuln: advisory('<2.0.0', '>=2.0.0') }
    const lf = lock([{ id: 'vuln@^1.0.0', version: '1.0.0' }])
    const fmt = getLockfileType(lf)

    // Control — no override: the newly-pulled transitive resolves to the highest
    // version IN its declared range (`new-dep@^1.0.0` → 1.5.0), never 2.0.0.
    const bare = format(
      await patch(parse(lf, fmt), report, ctx({ silent: true }, mockRegistry(spec)), fmt),
      fmt,
    )
    expect(bare).toContain('version "1.5.0"')

    // With a `resolutions` pin: `new-dep` is forced to 2.0.0 — OUTSIDE `^1.0.0`
    // (override replaces the range, not constrains it). Capture mirrors the runtime
    // wiring: parse(manifest) → overridesOf → patch(overrides).
    const graph = parse(lf, fmt, undefined, { resolutions: { 'new-dep': '2.0.0' } })
    const overrides = overridesOf(graph)
    expect(overrides.map((o) => `${o.package}@${o.to}`)).toEqual(['new-dep@2.0.0'])

    const pinned = format(
      await patch(graph, report, ctx({ silent: true }, mockRegistry(spec)), fmt, overrides),
      fmt,
    )
    expect(pinned).toContain('new-dep@')
    expect(pinned).toMatch(/new-dep@[\s\S]*?version "2\.0\.0"/) // pinned target won
    expect(pinned).not.toContain('version "1.5.0"') // in-range highest overridden
  })

  // `npm audit fix --force` parity: a user's override is authoritative — npm leaves
  // a pin holding a vulnerable version in place (never rewrites it), so yaf does too.
  describe('override authority (npm audit fix --force parity)', () => {
    const report = { vuln: advisory('<2.0.0', '>=2.0.0') }
    const spec = { vuln: { '1.0.0': {}, '2.0.0': {} } }
    const lf = lock([{ id: 'vuln@^1.0.0', version: '1.0.0' }])
    const fmt = getLockfileType(lf)
    const runOvr = async (
      resolutions: Record<string, string>,
      flags: Record<string, any> = {},
    ): Promise<string> => {
      const g = parse(lf, fmt, undefined, { resolutions })
      const out = await patch(
        g,
        report,
        ctx({ silent: true, ...flags }, mockRegistry(spec)),
        fmt,
        overridesOf(g),
      )
      return format(out, fmt)
    }

    it('leaves a package pinned to a vulnerable version — even with --force', async () => {
      const out = await runOvr({ vuln: '1.0.0' }, { force: true })
      expect(out).toContain('version "1.0.0"') // left at the pinned (vuln) version
      expect(out).not.toContain('version "2.0.0"') // NOT bumped, NOT rewritten
    })

    it('still fixes when the pin is a range that admits the fix', async () => {
      const out = await runOvr({ vuln: '>=1.0.0' })
      expect(out).toContain('version "2.0.0"') // bump stays within the pin
    })

    it('leaves a package under a DEEP-scope override untouched (v1 under-match guard)', async () => {
      const g = parse(lf, fmt, undefined, { resolutions: { 'a/b/vuln': '2.0.0' } })
      // ≥2 ancestors → the lib's single-level matcher under-matches, so we can't
      // prove which subtree it governs → leave the package be (conservative).
      expect(overridesOf(g).some((o) => (o.parentPath?.length ?? 0) >= 2)).toBe(true)
      const out = format(
        await patch(g, report, ctx({ silent: true }, mockRegistry(spec)), fmt, overridesOf(g)),
        fmt,
      )
      expect(out).toContain('version "1.0.0"') // untouched
      expect(out).not.toContain('version "2.0.0"') // not bumped
    })
  })

  it('leaves a package matched by --exclude untouched', async () => {
    const spec = { vuln: { '1.0.0': {}, '2.0.0': {} } }
    const report = { vuln: advisory('<2.0.0', '>=2.0.0') }
    const lf = lock([{ id: 'vuln@^1.0.0', version: '1.0.0' }])

    expect(await run(lf, report, { silent: true }, spec)).toContain(
      'version "2.0.0"',
    )
    const excluded = await run(lf, report, { silent: true, exclude: 'vuln' }, spec)
    expect(excluded).toContain('version "1.0.0"')
    expect(excluded).not.toContain('version "2.0.0"')
  })

  it('skips a fix that breaks a surviving consumer range unless --force', async () => {
    const spec = { vuln: { '1.0.0': {}, '2.0.0': {} }, consumer: { '1.0.0': {} } }
    const report = { vuln: advisory('<2.0.0', '>=2.0.0') }
    const lf = lock([
      { id: 'consumer@^1.0.0', version: '1.0.0', deps: { vuln: '^1.0.0' } },
      { id: 'vuln@^1.0.0', version: '1.0.0' },
    ])

    // default: consumer still wants vuln@^1.0.0 → cross-major bump skipped
    const guarded = await run(lf, report, { silent: true }, spec)
    expect(guarded).toContain('version "1.0.0"')
    expect(guarded).not.toContain('version "2.0.0"')

    // --force: gate bypassed
    const forced = await run(lf, report, { silent: true, force: true }, spec)
    expect(forced).toContain('version "2.0.0"')
  })

  it('is a no-op when the installed version already clears the advisory', async () => {
    const out = await run(
      lock([{ id: 'vuln@^2.0.0', version: '2.0.0' }]),
      { vuln: advisory('<3.0.0', '>=2.0.0') },
      { silent: true },
      { vuln: { '2.0.0': {} } },
    )
    expect(out).toContain('version "2.0.0"') // already at fix → unchanged
  })

  it('makes no change when nothing published clears the advisory', async () => {
    const out = await run(
      lock([{ id: 'vuln@^1.0.0', version: '1.0.0' }]),
      { vuln: advisory('<99.0.0', '>=99.0.0') },
      { silent: true },
      { vuln: { '1.0.0': {}, '2.0.0': {} } },
    )
    expect(out).toContain('version "1.0.0"') // no published fix → left as-is
    expect(out).not.toContain('version "2.0.0"')
  })

  // Capture stdout+stderr around a non-silent patch.
  const capture = async (fn: () => Promise<unknown>): Promise<string> => {
    const out: string[] = []
    const orig = { log: console.log, warn: console.warn }
    console.log = (...a: any[]) => void out.push(a.join(' '))
    console.warn = (...a: any[]) => void out.push(a.join(' '))
    try {
      await fn()
    } finally {
      console.log = orig.log
      console.warn = orig.warn
    }
    return out.join('\n')
  }

  it('prints the non-silent summary (upgraded / excluded / no-fix / skipped)', async () => {
    const out = await capture(() =>
      run(
        lock([
          { id: 'consumer@^1.0.0', version: '1.0.0', deps: { skipme: '^1.0.0' } },
          { id: 'skipme@^1.0.0', version: '1.0.0' }, // cross-major fix → gate skips
          { id: 'up@^1.0.0', version: '1.0.0' }, // in-range fix → upgraded
          { id: 'exme@^1.0.0', version: '1.0.0' }, // --exclude
          { id: 'nofixme@^1.0.0', version: '1.0.0' }, // no published fix
        ]),
        {
          skipme: advisory('<2.0.0', '>=2.0.0'),
          up: advisory('<1.5.0', '>=1.5.0'),
          exme: advisory('<2.0.0', '>=2.0.0'),
          nofixme: advisory('<99.0.0', '>=99.0.0'),
        },
        { silent: false, exclude: 'exme' },
        {
          consumer: { '1.0.0': {} },
          skipme: { '1.0.0': {}, '2.0.0': {} },
          up: { '1.0.0': {}, '1.5.0': {} },
          exme: { '1.0.0': {}, '2.0.0': {} },
          nofixme: { '1.0.0': {} },
        },
      ),
    )
    expect(out).toMatch(/Upgraded deps \(1\):/)
    expect(out).toMatch(/up@1\.0\.0 → 1\.5\.0/)
    expect(out).toMatch(/Excluded \(per --exclude\): exme@1\.0\.0/)
    expect(out).toMatch(/No fix available: nofixme/)
    expect(out).toMatch(/Skipped \(fix breaks/)
    expect(out).toMatch(/skipme@1\.0\.0 → 2\.0\.0/)
  })

  it('reports "no issues" + leaves the lockfile alone for an empty report', async () => {
    const input = lock([{ id: 'lodash@^4.17.0', version: '4.17.20' }])
    const out = await capture(() => run(input, {}, { silent: false }, {}))
    expect(out).toMatch(/Audit check found no issues/)
  })

  it('reports a package left pinned by an override (no rewrite)', async () => {
    const g = parse(
      lock([{ id: 'vuln@^1.0.0', version: '1.0.0' }]),
      'yarn-classic',
      undefined,
      { resolutions: { vuln: '1.0.0' } }, // exact pin on the vulnerable version
    )
    const out = await capture(() =>
      patch(
        g,
        { vuln: advisory('<2.0.0', '>=2.0.0') },
        ctx({ silent: false }, mockRegistry({ vuln: { '1.0.0': {}, '2.0.0': {} } })),
        'yarn-classic',
        overridesOf(g),
      ),
    )
    expect(out).toMatch(/Skipped \(pinned by an override/)
    expect(out).toContain('vuln@1.0.0 (pinned → 1.0.0)')
  })

  describe('manifest gate (direct-dep whose declared range the fix falls outside)', () => {
    const report = { lodash: advisory('<4.18.0', '>=4.18.0') }
    const spec = { lodash: { '4.17.11': {}, '4.18.0': {} } }
    const ctxM = (
      flags: Record<string, any>,
      manifest: Record<string, any>,
    ): TContext =>
      ({ flags, registry: mockRegistry(spec), manifest, cwd: process.cwd() }) as unknown as TContext

    it('flags + skips a non-admitting direct-dep pin by default (no bump, no rewrite)', async () => {
      const lf = lock([{ id: 'lodash@4.17.11', version: '4.17.11' }]) // exact pin
      const manifest = { dependencies: { lodash: '4.17.11' } }
      const out = await capture(() =>
        patch(parse(lf, 'yarn-classic'), report, ctxM({ silent: false }, manifest), 'yarn-classic'),
      )
      expect(out).toMatch(/Skipped \(package\.json pins/)
      expect(out).toContain('lodash@4.17.11 (pinned → "4.17.11")')
      const c = ctxM({ silent: true }, manifest)
      const patched = format(await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic'), 'yarn-classic')
      expect(patched).toContain('version "4.17.11"') // left at the vulnerable version
      expect(patched).not.toContain('version "4.18.0"')
      expect(c.manifestEdits).toBeUndefined()
    })

    it('records the range rewrite + applies the bump under --force', async () => {
      const lf = lock([{ id: 'lodash@4.17.11', version: '4.17.11' }])
      const c = ctxM({ silent: true, force: true }, { dependencies: { lodash: '4.17.11' } })
      const out = format(await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic'), 'yarn-classic')
      expect(out).toContain('version "4.18.0"') // bumped
      expect(c.manifestEdits).toEqual([{ name: 'lodash', from: '4.17.11', to: '4.18.0' }])
    })

    it('preserves the pin operator in the rewrite (~4.17.0 → ~4.18.0)', async () => {
      const lf = lock([{ id: 'lodash@~4.17.0', version: '4.17.11' }])
      const c = ctxM({ silent: true, force: true }, { dependencies: { lodash: '~4.17.0' } })
      await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic')
      expect(c.manifestEdits).toEqual([{ name: 'lodash', from: '~4.17.0', to: '~4.18.0' }])
    })

    it('does NOT trip when the declared range already admits the fix (caret)', async () => {
      const lf = lock([{ id: 'lodash@^4.17.0', version: '4.17.11' }])
      const c = ctxM({ silent: true }, { dependencies: { lodash: '^4.17.0' } })
      const out = format(await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic'), 'yarn-classic')
      expect(out).toContain('version "4.18.0"') // ^4.17.0 admits 4.18.0 → bumped
      expect(c.manifestEdits).toBeUndefined() // no manifest change
    })

    it('flags a pin declared in devDependencies (not just dependencies)', async () => {
      const lf = lock([{ id: 'lodash@4.17.11', version: '4.17.11' }])
      const c = ctxM({ silent: true }, { devDependencies: { lodash: '4.17.11' } })
      const out = format(await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic'), 'yarn-classic')
      expect(out).toContain('version "4.17.11"') // skipped
      expect(c.manifestEdits).toBeUndefined()
    })

    it('mixes: a non-admitting pin is flagged while an admitting sibling still bumps (--force)', async () => {
      const spec2 = {
        lodash: { '4.17.11': {}, '4.18.0': {} },
        minimist: { '1.2.5': {}, '1.2.6': {} },
      }
      const lf = lock([
        { id: 'lodash@4.17.11', version: '4.17.11' },
        { id: 'minimist@^1.2.0', version: '1.2.5' },
      ])
      const report2 = {
        lodash: advisory('<4.18.0', '>=4.18.0'),
        minimist: advisory('<1.2.6', '>=1.2.6'),
      }
      const c = {
        flags: { silent: true, force: true },
        registry: mockRegistry(spec2),
        manifest: { dependencies: { lodash: '4.17.11', minimist: '^1.2.0' } },
        cwd: process.cwd(),
      } as unknown as TContext
      const out = format(await patch(parse(lf, 'yarn-classic'), report2, c, 'yarn-classic'), 'yarn-classic')
      expect(out).toContain('version "4.18.0"') // lodash: --force rewrote the pin → bumped
      expect(out).toContain('version "1.2.6"') // minimist: ^1.2.0 admits it → bumped, no rewrite
      expect(c.manifestEdits).toEqual([{ name: 'lodash', from: '4.17.11', to: '4.18.0' }])
    })

    it('leaves a non-semver range (workspace:) alone — the validRange guard skips the gate', async () => {
      const lf = lock([{ id: 'lodash@4.17.11', version: '4.17.11' }])
      const c = ctxM({ silent: true, force: true }, { dependencies: { lodash: 'workspace:*' } })
      const out = format(await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic'), 'yarn-classic')
      expect(out).toContain('version "4.18.0"') // not gated → bumped via the normal path
      expect(c.manifestEdits).toBeUndefined() // never rewritten
    })

    it('a `*` range admits every fix — no trip', async () => {
      const lf = lock([{ id: 'lodash@*', version: '4.17.11' }])
      const c = ctxM({ silent: true }, { dependencies: { lodash: '*' } })
      const out = format(await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic'), 'yarn-classic')
      expect(out).toContain('version "4.18.0"') // bumped
      expect(c.manifestEdits).toBeUndefined()
    })

    it('widens a complex range the fix falls outside → caret of the fix', async () => {
      const lf = lock([{ id: 'lodash@>=4.0.0 <4.17.12', version: '4.17.11' }])
      const c = ctxM({ silent: true, force: true }, { dependencies: { lodash: '>=4.0.0 <4.17.12' } })
      await patch(parse(lf, 'yarn-classic'), report, c, 'yarn-classic')
      expect(c.manifestEdits).toEqual([{ name: 'lodash', from: '>=4.0.0 <4.17.12', to: '^4.18.0' }])
    })

    it('applyManifestEdit rewrites the range surgically, preserving formatting', () => {
      const pkg = '{\n  "dependencies": {\n    "@scope/x": "1.2.3",\n    "y": "^2.0.0"\n  }\n}\n'
      expect(applyManifestEdit(pkg, { name: '@scope/x', from: '1.2.3', to: '2.0.0' })).toBe(
        '{\n  "dependencies": {\n    "@scope/x": "2.0.0",\n    "y": "^2.0.0"\n  }\n}\n',
      )
    })

    it('applyManifestEdit updates every field the exact pin appears in', () => {
      const pkg = '{"dependencies":{"x":"1.0.0"},"devDependencies":{"x":"1.0.0"}}'
      expect(applyManifestEdit(pkg, { name: 'x', from: '1.0.0', to: '2.0.0' })).toBe(
        '{"dependencies":{"x":"2.0.0"},"devDependencies":{"x":"2.0.0"}}',
      )
    })

    it('applyManifestEdit is a no-op when the exact pin is absent (never touches ^1.0.0)', () => {
      const pkg = '{"dependencies":{"x":"^1.0.0","x-extra":"1.0.0"}}'
      expect(applyManifestEdit(pkg, { name: 'x', from: '1.0.0', to: '2.0.0' })).toBe(pkg)
    })
  })
})

// `refurbish` fills install-required fields a patched graph still lacks — today
// the yarn-berry zip `checksum`, recomputed from the npm tarball. Tarball bytes
// come from committed `.tgz` fixtures (no network), so the recompute is asserted
// byte-for-byte against the value yarn itself wrote.
describe('refurbish', () => {
  const tarballsDir = path.resolve(__dirname, '../fixtures/tarballs')
  // Disk-backed TarballSource → hermetic, deterministic checksum recompute.
  const diskTarballs = {
    tarball: async (name: string, version: string) => {
      try {
        return new Uint8Array(
          readFileSync(path.join(tarballsDir, `${name}-${version}.tgz`)),
        )
      } catch {
        return undefined
      }
    },
  }
  const rctx = (tarballSource?: any): TContext =>
    ({ flags: { silent: true }, tarballSource, cwd: process.cwd() }) as unknown as TContext

  const grabChecksum = (text: string, name: string): string | undefined =>
    new RegExp(`"${name}@npm:[^"]*":[\\s\\S]*?\\n  checksum: (10c0/[0-9a-f]+)`)
      .exec(text)?.[1]

  it('recomputes the yarn-berry checksum byte-for-byte from the tarball', async () => {
    const v4 = path.resolve(__dirname, '../fixtures/lockfile/v4/yarn.lock')
    const input = readFileSync(v4, 'utf-8')
    const expected = {
      'color-name': grabChecksum(input, 'color-name'),
      'has-flag': grabChecksum(input, 'has-flag'),
    }
    expect(expected['color-name']).toBeTruthy()

    // Strip the two checksums to mimic freshly-added nodes lacking them.
    let stripped = input
    for (const cks of Object.values(expected))
      stripped = stripped.replace(`\n  checksum: ${cks}`, '')
    expect(stripped).not.toEqual(input)

    const fmt = getLockfileType(stripped)
    const out = format(
      await refurbish(parse(stripped, fmt), fmt, rctx(diskTarballs)),
      fmt,
    )

    for (const [name, cks] of Object.entries(expected))
      expect(grabChecksum(out, name)).toBe(cks)
    // Restoring exactly the two stripped fields round-trips to the original.
    expect(out).toBe(input)
  })

  it('is a no-op for yarn-classic (nodes already complete)', async () => {
    const input = lock([{ id: 'lodash@^4.17.0', version: '4.17.20' }])
    const fmt = getLockfileType(input)
    // No tarballSource needed: classic is skipped entirely.
    const out = format(await refurbish(parse(input, fmt), fmt, rctx()), fmt)
    expect(out).toBe(format(parse(input, fmt), fmt))
  })

  it('throws on an unrecognised lockfile format', async () => {
    await expect(refurbish({} as any, undefined, rctx())).rejects.toThrow(
      'Unsupported lockfile format',
    )
  })

  it('defers bare-era (yarn-3 / berry-v6) checksums — never fills or fetches', async () => {
    const v3 = path.resolve(__dirname, '../fixtures/lockfile/v3/yarn.lock')
    const input = readFileSync(v3, 'utf-8')
    // strip the checksum to mimic a freshly-added node refurbish would fill
    const stripped = input.replace(/\n {2}checksum: [0-9a-f]+/, '')
    expect(stripped).not.toEqual(input)
    const fmt = getLockfileType(stripped)
    expect(fmt).toBe('yarn-berry-v6')

    let fetched = 0
    const source = {
      tarball: async () => {
        fetched += 1
        return undefined
      },
    }
    const out = format(await refurbish(parse(stripped, fmt), fmt, rctx(source)), fmt)

    // yarn 2.x/3.x checksums are bare (no cacheKey prefix) + DEFLATE, not
    // reproducible from the npm tarball — so refurbish must defer (never fetch,
    // never fill) and let `yarn install` self-heal. Guards the snapshot.73
    // "fill with 10c0/<hex> STORE form" lock-corruption regression.
    expect(fetched).toBe(0)
    expect(out).not.toMatch(/10c0\//)
    expect(out).toBe(stripped)
  })

  // Capture console.warn (no ctx.progress ⇒ refurbish warns through it).
  const captureWarn = async (flags: Record<string, any>): Promise<string> => {
    const v3 = path.resolve(__dirname, '../fixtures/lockfile/v3/yarn.lock')
    const stripped = readFileSync(v3, 'utf-8').replace(/\n {2}checksum: [0-9a-f]+/, '')
    const fmt = getLockfileType(stripped)
    const lines: string[] = []
    const orig = console.warn
    console.warn = (...a: any[]) => void lines.push(a.map(String).join(' '))
    try {
      const ctx = {
        flags,
        cwd: process.cwd(),
        tarballSource: { tarball: async () => undefined },
      } as unknown as TContext
      await refurbish(parse(stripped, fmt), fmt, ctx)
    } finally {
      console.warn = orig
    }
    return lines.join('\n')
  }

  it('warns about deferred checksums when not silent (collapsed count)', async () => {
    const out = await captureWarn({ silent: false })
    expect(out).toMatch(/Could not compute checksums for 1 package/)
    expect(out).toMatch(/1× ENRICH_CHECKSUM_DEFERRED/)
  })

  it('lists each deferred checksum under --verbose', async () => {
    const out = await captureWarn({ silent: false, verbose: true })
    expect(out).toMatch(/\[\w+\] ENRICH_CHECKSUM_DEFERRED:/)
  })
})
