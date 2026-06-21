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
})
