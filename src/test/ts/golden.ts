import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { liveRegistry } from '@antongolub/lockfile/registry'

import { format, getLockfileType, parse, patch } from '../../main/ts/lockfile'
import { parseAuditReport as parseAuditV1 } from '../../main/ts/audit/v1'
import { parseAuditReport as parseAuditV2 } from '../../main/ts/audit/v2'
import { parseAuditReport as parseAuditV4 } from '../../main/ts/audit/v4'
import type { TContext } from '../../main/ts/ifaces'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(__dirname, '../fixtures')

// REGEN_FIXTURES=1 records live packument/resolve responses into a committed
// JSON + writes the golden output; otherwise the test replays the canned JSON
// (no network) and asserts byte-identical output — including the completed
// transitive closure. So the goldens are deterministic forever.
const REGEN = !!process.env.REGEN_FIXTURES

type Canned = { packuments: Record<string, any>; resolves: Record<string, any> }

const recordingRegistry = () => {
  const live = liveRegistry()
  const packuments: Record<string, any> = {}
  const resolves: Record<string, any> = {}
  return {
    adapter: {
      packument: async (n: string) => {
        const p = await live.packument(n)
        if (p) packuments[n] = p
        return p
      },
      resolve: async (n: string, r: string) => {
        const v = await live.resolve(n, r)
        resolves[`${n}\t${r}`] = v ?? null
        return v
      },
    },
    // Trim recorded packuments to the versions actually present in the result —
    // keeps the canned JSON minimal while still covering `lowestFix`.
    dump: (graph: any): Canned => {
      const used: Record<string, Set<string>> = {}
      for (const node of graph.nodes())
        (used[node.name] ??= new Set()).add(node.version)
      const out: Record<string, any> = {}
      for (const [name, p] of Object.entries(packuments)) {
        const keep = used[name]
        if (!keep) continue
        out[name] = { name: (p as any).name, distTags: {}, versions: {} }
        for (const v of keep)
          if ((p as any).versions[v]) out[name].versions[v] = (p as any).versions[v]
      }
      return { packuments: out, resolves }
    },
  }
}

const cannedRegistry = ({ packuments, resolves }: Canned) => ({
  packument: async (n: string) => packuments[n],
  resolve: async (n: string, r: string) => resolves[`${n}\t${r}`] ?? undefined,
})

// A descriptor (`name@range`) must resolve to exactly ONE entry — yarn dedups it
// project-wide, so the same range string in two entry headers is a malformed lock
// that `yarn install --immutable` rejects. This guards the completion
// double-binding class of regression (caught in @antongolub/lockfile snapshot.77:
// `'highest'` minted a 2nd entry for an already-bound range → e.g. semver@^7.3.5
// in two entries). Works for berry (quoted) + classic (bare) entry headers.
const duplicateDescriptors = (lock: string): string[] => {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const line of lock.split('\n')) {
    // entry header = unindented line ending in ':' (skip comments + __metadata)
    if (/^\s/.test(line) || line.startsWith('#') || !line.trimEnd().endsWith(':'))
      continue
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

describe('patch golden (record/replay registry)', () => {
  const cases = [
    // three schemas, full upgrade set
    { name: 'yarn-classic', dir: 'v1', parseAudit: parseAuditV1, ext: 'json', force: true },
    { name: 'yarn-berry-v5', dir: 'v2', parseAudit: parseAuditV2, ext: 'json', force: true },
    { name: 'yarn-berry-v8', dir: 'v4', parseAudit: parseAuditV4, ext: 'ndjson', force: true },
    // vulnerable parent + child (and declaration order) on a real classic lock
    { name: 'yarn-classic', dir: 'v1-cross', parseAudit: parseAuditV1, ext: 'json', force: true },
    { name: 'yarn-classic', dir: 'v1-cross2', parseAudit: parseAuditV1, ext: 'json', force: true },
    // compat gate ON (default): a fix breaking a surviving consumer is skipped
    { name: 'yarn-classic', dir: 'v1-compat', parseAudit: parseAuditV1, ext: 'json', force: false },
  ] as const

  for (const { name, dir, parseAudit, ext, force } of cases) {
    it(`patches ${dir} (${name}) byte-for-byte`, async () => {
      const base = path.join(fixtures, `lockfile/${dir}`)
      const input = fs.readFileSync(path.join(base, 'yarn.lock'), 'utf-8')
      const report = parseAudit(
        fs.readFileSync(path.join(base, `yarn-audit-report.${ext}`), 'utf-8'),
      )
      const fmt = getLockfileType(input)
      expect(fmt).toBe(name)

      const cannedPath = path.join(base, 'registry-canned.json')
      const goldenPath = path.join(base, 'yarn-lock-patched.yaml')

      const rec = REGEN ? recordingRegistry() : undefined
      const registry = rec
        ? rec.adapter
        : cannedRegistry(JSON.parse(fs.readFileSync(cannedPath, 'utf-8')))

      const result = await patch(
        parse(input, fmt),
        report,
        { flags: { silent: true, force }, registry } as unknown as TContext,
        fmt,
      )
      const out = format(result, fmt)

      // No descriptor may be double-bound (malformed → `yarn install --immutable`
      // rejects). Runs in both record + replay so a bad regen can't be committed.
      expect(duplicateDescriptors(out)).toEqual([])

      if (rec) {
        fs.writeFileSync(cannedPath, JSON.stringify(rec.dump(result)))
        fs.writeFileSync(goldenPath, out)
      }

      expect(out).toEqual(fs.readFileSync(goldenPath, 'utf-8'))
    })
  }
})
