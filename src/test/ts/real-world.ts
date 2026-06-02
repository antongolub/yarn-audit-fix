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

const ctxForce = { flags: { silent: true, force: true }, bins: {} } as unknown as TContext
const ctxDefault = { flags: { silent: true }, bins: {} } as unknown as TContext

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
      it(handle, () => {
        const raw = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf-8')
        const fmt = getLockfileType(raw)
        const before = parse(raw, fmt, dir)

        const report = reportFor(before)
        const targets = Object.keys(report)
        if (targets.length === 0) return
        exercised++

        const after = patch(before, report, ctxForce, fmt)
        const nodes = [...after.nodes()]

        for (const name of targets) {
          const own = nodes.filter((n) => n.name === name)
          expect(own.filter((n) => sv.satisfies(n.version, report[name].vulnerable_versions))).toEqual([])
          expect(own.some((n) => sv.satisfies(n.version, report[name].patched_versions))).toBe(true)
          cleared++
        }

        expect([...parse(format(after, fmt), fmt, dir).nodes()].length).toBeGreaterThan(0)
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
    for (const { handle, dir } of lockfiles.filter((f) => f.vulnerable)) {
      it(handle, () => {
        const raw = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf-8')
        const fmt = getLockfileType(raw)
        const before = parse(raw, fmt, dir)

        const report = reportFor(before)
        const vBefore = countVuln(before, report)
        expect(vBefore).toBeGreaterThan(0)

        const after = patch(before, report, ctxDefault, fmt)
        const vAfter = countVuln(after, report)

        // real, compat-safe progress (some vulns fixed in-major)
        expect(vAfter).toBeLessThan(vBefore)
        // result is still a valid lockfile
        expect([...parse(format(after, fmt), fmt, dir).nodes()].length).toBeGreaterThan(0)
      })
    }
  })

  // The current fixtures keep the full nested package.json tree, so workspace
  // discovery (used by createSymlinks) resolves real monorepo members.
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
