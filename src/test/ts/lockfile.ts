import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getNpm, getYarn, TContext } from '../../main/ts'
import { format, getLockfileType, parse, patch } from '../../main/ts/lockfile'
import { parseAuditReport as parseAuditV1 } from '../../main/ts/audit/v1'
import { parseAuditReport as parseAuditV2 } from '../../main/ts/audit/v2'
import { parseAuditReport as parseAuditV4 } from '../../main/ts/audit/v4'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.resolve(__dirname, '../fixtures')

describe('patch', () => {
  const bins: Record<string, string> = {
    npm: getNpm(),
    yarn: getYarn(),
  }

  const cases = [
    { name: 'yarn-berry-v5', dir: 'v2', parseAudit: parseAuditV2, ext: 'json' },
    { name: 'yarn-berry-v8', dir: 'v4', parseAudit: parseAuditV4, ext: 'ndjson' }, // yarn v4 (issue #248)
    { name: 'yarn-classic',  dir: 'v1', parseAudit: parseAuditV1, ext: 'json' },
  ] as const

  for (const { name, dir, parseAudit, ext } of cases) {
    it(`patches ${name} lockfile`, () => {
      const report = fs.readFileSync(
        path.join(fixtures, `lockfile/${dir}/yarn-audit-report.${ext}`),
        'utf-8',
      )
      const lockfile = fs.readFileSync(
        path.join(fixtures, `lockfile/${dir}/yarn.lock`),
        'utf-8',
      )
      const expected = fs.readFileSync(
        path.join(fixtures, `lockfile/${dir}/yarn-lock-patched.yaml`),
        'utf-8',
      )
      const fmt = getLockfileType(lockfile)
      expect(fmt).toBe(name)

      // force: these fixtures exercise the full patch mechanics — they bump
      // transitive deps across majors that the compat gate would otherwise
      // skip. The gate itself is covered by the v1-compat case below.
      const result = format(
        patch(
          parse(lockfile, fmt),
          parseAudit(report),
          { flags: { silent: true, force: true }, bins } as unknown as TContext,
          fmt,
        ),
        fmt,
      )

      expect(result).toEqual(expected)
    })
  }

  // Regression: a vulnerable parent and its vulnerable child both in the
  // upgrade set. Removing the parent cascades its outgoing edge, so the
  // child's stale graph.in() view referenced an already-gone edge and
  // mutate() threw PATCH_REJECTED. See lockfile.ts removedIds guard.
  it('patches a vulnerable parent + child without rejecting', () => {
    const dir = path.join(fixtures, 'lockfile/v1-cross')
    const lockfile = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf-8')
    const report = parseAuditV1(
      fs.readFileSync(path.join(dir, 'yarn-audit-report.json'), 'utf-8'),
    )
    const fmt = getLockfileType(lockfile)
    expect(fmt).toBe('yarn-classic')

    // bins:{} → offline minVersion fallback, deterministic: glob→11.0.0,
    // minimatch→10.0.0.
    const result = format(
      patch(
        parse(lockfile, fmt),
        report,
        { flags: { silent: true }, bins: {} } as unknown as TContext,
        fmt,
      ),
      fmt,
    )

    expect(result).toContain('glob@11.0.0')
    expect(result).toContain('minimatch@10.0.0')
    expect(result).not.toContain('glob@^10.0.0:\n  version "10.4.5"')
  })

  // Mirror of the above with the child declared BEFORE the parent, so node
  // iteration removes the child first. The per-node interleaving threw
  // "removeNode: <child> has incoming edges"; the phased mutate is order-free.
  it('patches a vulnerable child + parent regardless of declaration order', () => {
    const dir = path.join(fixtures, 'lockfile/v1-cross2')
    const lockfile = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf-8')
    const report = parseAuditV1(
      fs.readFileSync(path.join(dir, 'yarn-audit-report.json'), 'utf-8'),
    )
    const fmt = getLockfileType(lockfile)

    const result = format(
      patch(
        parse(lockfile, fmt),
        report,
        { flags: { silent: true }, bins: {} } as unknown as TContext,
        fmt,
      ),
      fmt,
    )

    expect(result).toContain('glob@11.0.0')
    expect(result).toContain('minimatch@10.0.0')
  })

  // Compat gate: the only fix for uuid (v11) leaves its consumer request's
  // declared "^3.3.2" range. request isn't itself patchable, so the bump is
  // skipped by default and applied only with --force.
  it('skips a fix that breaks a surviving consumer range unless --force', () => {
    const dir = path.join(fixtures, 'lockfile/v1-compat')
    const lockfile = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf-8')
    const report = parseAuditV1(
      fs.readFileSync(path.join(dir, 'yarn-audit-report.json'), 'utf-8'),
    )
    const fmt = getLockfileType(lockfile)

    // default: gate on → uuid untouched, stays at 3.4.0
    const guarded = format(
      patch(
        parse(lockfile, fmt),
        report,
        { flags: { silent: true }, bins: {} } as unknown as TContext,
        fmt,
      ),
      fmt,
    )
    expect(guarded).toContain('version "3.4.0"')
    expect(guarded).not.toContain('version "11.0.0"')

    // --force: gate bypassed → the uuid@^3.3.2 descriptor now resolves to 11.x
    const forced = format(
      patch(
        parse(lockfile, fmt),
        report,
        { flags: { silent: true, force: true }, bins: {} } as unknown as TContext,
        fmt,
      ),
      fmt,
    )
    expect(forced).toContain('version "11.0.0"')
    expect(forced).not.toContain('version "3.4.0"')
  })
})
