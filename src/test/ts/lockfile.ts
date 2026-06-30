import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sv from 'semver'

import { TAuditReport, TContext } from '../../main/ts/ifaces'
import {
  format,
  getLockfileType,
  parse,
  patch,
  refurbish,
} from '../../main/ts/lockfile'

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
