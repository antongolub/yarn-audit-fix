import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sv from 'semver'

import { TContext } from '../../main/ts'
import { format, getLockfileType, parse, patch } from '../../main/ts/lockfile'
import { getWorkspaces, readJson } from '../../main/ts/util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(__dirname, '../fixtures')
const realWorld = path.join(fixtures, 'real-world')
const vulnerable = path.join(fixtures, 'vulnerable')

const dirsOf = (base: string): string[] =>
  fs.existsSync(base)
    ? fs
        .readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : []

// Famous current repos (full nested trees) + older vulnerable snapshots
// (lockfile-only) that still carry unpatched deps.
const lockfiles = [
  ...dirsOf(realWorld).map((h) => ({ handle: h, dir: path.join(realWorld, h), vulnerable: false })),
  ...dirsOf(vulnerable).map((h) => ({ handle: h, dir: path.join(vulnerable, h), vulnerable: true })),
]

type Advisory = {
  module_name: string
  vulnerable_versions: string
  patched_versions: string
  severity?: string
  refs?: string[]
}

// Local CVE cache → no `yarn audit` / network needed.
const advisories = Object.fromEntries(
  Object.entries(
    JSON.parse(fs.readFileSync(path.join(fixtures, 'advisories.json'), 'utf-8')) as Record<string, Advisory>,
  ).filter(([k]) => !k.startsWith('_')),
)

const reportFor = (graph: ReturnType<typeof parse>): Record<string, Advisory> => {
  const report: Record<string, Advisory> = {}
  for (const node of graph.nodes()) {
    const adv = advisories[node.name]
    if (adv && sv.valid(node.version) && sv.satisfies(node.version, adv.vulnerable_versions)) {
      report[node.name] = adv
    }
  }
  return report
}

const countVuln = (graph: ReturnType<typeof parse>, report: Record<string, Advisory>): number =>
  [...graph.nodes()].filter(
    (n) => report[n.name] && sv.satisfies(n.version, report[n.name].vulnerable_versions),
  ).length

// Hermetic RegistryAdapter derived from the local advisory cache: each fixable
// package resolves to `minVersion(patched_versions)` with no declared deps — so
// the bump happens offline (same fix version as before) and `completeTransitives`
// has nothing to fetch. Completion itself is covered in lockfile.ts.
const fixVersionOf = (name: string): string | undefined =>
  advisories[name] ? sv.minVersion(advisories[name].patched_versions)?.version : undefined

const mockRegistry = {
  packument: async (name: string) => {
    const fix = fixVersionOf(name)
    return fix
      ? {
          name,
          distTags: { latest: fix },
          versions: { [fix]: { name, version: fix, dependencies: {} } },
        }
      : undefined
  },
  resolve: async (name: string, range: string) => {
    const fix = fixVersionOf(name)
    return fix && (range === fix || sv.satisfies(fix, range))
      ? { name, version: fix, dependencies: {} }
      : undefined
  },
} as any

const ctxForce = { flags: { silent: true, force: true }, registry: mockRegistry } as unknown as TContext
const ctxDefault = { flags: { silent: true }, registry: mockRegistry } as unknown as TContext

// No descriptor (range string) may bind more than one entry — a malformed lock
// that `yarn install --immutable` rejects. Mirrors the golden guard, applied here
// across the broad real-world + vulnerable corpus (catches mutation-side
// double-binding / stale-key regressions on every @antongolub/lockfile bump).
const duplicateDescriptors = (lock: string): string[] => {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const line of lock.split('\n')) {
    if (/^\s/.test(line) || line.startsWith('#') || !line.trimEnd().endsWith(':')) continue
    const header = line.trimEnd().slice(0, -1)
    if (header === '__metadata') continue
    for (const raw of header.split(',')) {
      const d = raw.trim().replace(/^"|"$/g, '')
      if (!d) continue
      if (seen.has(d)) dups.add(d)
      seen.add(d)
    }
  }
  return [...dups]
}

describe('real-world yarn fixtures', () => {
  it('the corpus is present', () => {
    expect(lockfiles.length).toBeGreaterThan(0)
  })

  // yaf's own modification (graph edge-redirect patch). --force bypasses the
  // compat gate, so every matched vulnerability must be cleared. offline
  // (bins:{} → minVersion) keeps the resolved fix deterministic.
  describe('patch clears cached advisories (--force)', () => {
    let exercised = 0
    let cleared = 0

    for (const { handle, dir } of lockfiles) {
      it(handle, async () => {
        const raw = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf-8')
        const fmt = getLockfileType(raw)
        const before = parse(raw, fmt, dir)

        const report = reportFor(before)
        const targets = Object.keys(report)
        if (targets.length === 0) return
        exercised++

        // Pre-existing danglers (in-degree 0 at parse) that aren't themselves a
        // bump target must SURVIVE the patch: yarn / `--immutable` keep base
        // danglers, so `pruneOrphans` must `preserve` them. Guards the redwood-class
        // prune over-aggressiveness.
        const baseDanglers = [...before.nodes()]
          .filter((n) => before.in(n.id).length === 0 && !targets.includes(n.name))
          .map((n) => `${n.name}@${n.version}`)

        const after = await patch(before, report, ctxForce, fmt)
        const nodes = [...after.nodes()]

        for (const name of targets) {
          const own = nodes.filter((n) => n.name === name)
          // advisory cleared: no vulnerable version survives.
          expect(own.filter((n) => sv.satisfies(n.version, report[name].vulnerable_versions))).toEqual([])
          // cleared by upgrade (a patched version present) or by removal: the
          // offline mock gives fix versions no deps, so when --force co-bumps a
          // package *and* its only consumer, the consumer drops the edge and
          // pruneOrphans retires the now-orphaned target (a valid clear).
          expect(
            own.length === 0 ||
              own.some((n) => sv.satisfies(n.version, report[name].patched_versions)),
          ).toBe(true)
          cleared++
        }

        const out = format(after, fmt)
        expect([...parse(out, fmt, dir).nodes()].length).toBeGreaterThan(0)
        // descriptor integrity: no range string may bind >1 entry.
        expect(duplicateDescriptors(out), `${handle}: duplicate descriptor(s)`).toEqual([])
        // dangler preservation: no pre-existing base dangler may be GC'd by prune.
        const afterKeys = new Set(nodes.map((n) => `${n.name}@${n.version}`))
        expect(
          baseDanglers.filter((k) => !afterKeys.has(k)),
          `${handle}: pre-existing danglers dropped by prune`,
        ).toEqual([])
      })
    }

    it('covered most of the corpus', () => {
      expect(exercised).toBeGreaterThan(15)
      expect(cleared).toBeGreaterThan(30)
    })
  })

  // Default run (no --force): the compat gate applies only fixes that satisfy
  // every surviving consumer's range. Against genuinely-vulnerable older locks
  // this must make real progress (in-major bumps) while leaving cross-major
  // fixes for --force. Asserted on the vulnerable snapshots.
  describe('patch applies compat-safe fixes (default)', () => {
    let progressed = 0
    for (const { handle, dir } of lockfiles.filter((f) => f.vulnerable)) {
      it(handle, async () => {
        const raw = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf-8')
        const fmt = getLockfileType(raw)
        const before = parse(raw, fmt, dir)

        const report = reportFor(before)
        const vBefore = countVuln(before, report)
        expect(vBefore).toBeGreaterThan(0)

        const after = await patch(before, report, ctxDefault, fmt)
        const vAfter = countVuln(after, report)

        // the compat gate must never REGRESS; in-major progress happens where a
        // compat-safe fix exists — vulns fixable only cross-major are left for
        // --force (the force suite above proves those clear).
        expect(vAfter).toBeLessThanOrEqual(vBefore)
        progressed += vBefore - vAfter
        // result is still a valid lockfile
        expect([...parse(format(after, fmt), fmt, dir).nodes()].length).toBeGreaterThan(0)
      })
    }

    it('makes real in-major progress across the corpus', () => {
      expect(progressed).toBeGreaterThan(0)
    })
  })

  // The current fixtures keep the full nested package.json tree, so
  // `getWorkspaces` resolves real monorepo members.
  describe('workspace discovery', () => {
    for (const handle of dirsOf(realWorld)) {
      const dir = path.join(realWorld, handle)
      const manifest = readJson(path.join(dir, 'package.json'))
      if (!manifest.workspaces) continue

      it(handle, () => {
        const workspaces = getWorkspaces(dir, manifest)
        expect(workspaces.length).toBeGreaterThan(0)
        workspaces.forEach((ws) => expect(fs.existsSync(ws)).toBe(true))
      })
    }
  })
})
