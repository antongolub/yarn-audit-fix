import sv from 'semver'

import { TAuditReport, TContext } from '../../main/ts/ifaces'
import { format, getLockfileType, parse, patch } from '../../main/ts/lockfile'

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
