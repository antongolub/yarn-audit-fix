import cp from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TContext } from '../../main/ts/ifaces'

const lf = (await import('../../main/ts/lockfile'))._internal
const { createSymlinks, getContext, run } = await import('../../main/ts')
const { getYarn } = await import('../../main/ts/util')
const { parseAuditReport: parseAuditV1 } = await import(
  '../../main/ts/audit/v1'
)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Captured before the fs spies are installed; vitest lazily reads module
// sources through fs.readFileSync, so the mock must delegate real reads.
const realReadFileSync = fs.readFileSync
const noop = () => {
  /* noop */
}
const fixtures = path.resolve(__dirname, '../fixtures/')
const registryUrl = 'https://example.com'
const dependency = 'example-package'
const scopedDependency = '@scope/package'
const strMatching = (start = '', end = '') =>
  expect.stringMatching(new RegExp(`^${start}.+${end}$`))
// Read fixtures with the real fs (this runs at load time, before the spies
// in `beforeAll` replace fs.readFileSync).
const readFixture = (name: string): string =>
  fs.readFileSync(path.resolve(fixtures, name), { encoding: 'utf-8' })
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse#using_the_reviver_parameter
const revive = <T = any>(data: string): T =>
  JSON.parse(data, (k, v) => {
    if (
      v !== null &&
      typeof v === 'object' &&
      'type' in v &&
      v.type === 'Buffer' &&
      'data' in v &&
      Array.isArray(v.data)
    ) {
      return Buffer.from(v.data)
    }
    return v
  })
const audit = revive(readFixture('lockfile/legacy/yarn-audit-report.json'))
const yarnLockBefore = readFixture('lockfile/legacy/yarn.lock.before')
const yarnLockAfter = readFixture('lockfile/legacy/yarn.lock.after')
// `_audit` now fetches advisories over HTTP; stub it with the report the legacy
// fixture would have produced so the patch flow stays offline + deterministic.
const auditReport = parseAuditV1(String((audit as any).stdout ?? ''))

const cwd = process.cwd()

const shell = true
const temp = path.resolve(__dirname, '../../../.temp')
const stdio = ['inherit', 'inherit', 'inherit']
const stdionull = [null, null, null] // eslint-disable-line

const lfAudit = vi.spyOn(lf, '_audit')
const lfParse = vi.spyOn(lf, '_parse')
const lfPatch = vi.spyOn(lf, '_patch')
const lfFormat = vi.spyOn(lf, '_format')

describe('yarn-audit-fix', () => {
  beforeAll(() => {
    vi.spyOn(fs, 'copyFileSync').mockImplementation(noop)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(noop)
    vi.spyOn(fs, 'symlinkSync').mockImplementation(noop)
    vi.spyOn(fs, 'rmSync').mockImplementation(noop)
    // @ts-ignore
    vi.spyOn(fs, 'mkdirSync').mockImplementation(noop)
    // @ts-ignore
    vi.spyOn(fs, 'mkdtempSync').mockImplementation(() => temp)
    vi.spyOn(fs, 'existsSync').mockImplementation(() => true)
    // @ts-ignore
    vi.spyOn(fs, 'readFileSync').mockImplementation((name: any, ...rest: any[]) => {
      const s = String(name)
      // Only stub the project's own files; delegate everything else (vitest
      // module sources, node_modules, etc.) to the real fs.
      if (!s.includes('node_modules')) {
        const _name = path.basename(s)
        if (_name === 'yarn.lock') {
          return yarnLockBefore
        }
        if (_name === 'package.json') {
          return '{"version": "1.0.0"}'
        }
      }

      // @ts-ignore
      return realReadFileSync(name, ...rest)
    })
    // @ts-ignore
    vi.spyOn(cp, 'spawnSync').mockImplementation((cmd: string, [$0, $1]: string[]) => {
      if ($0 === 'audit' && $1 === '--json') {
        return audit
      }

      if ($0 === '--version' || (cmd === 'npm' && $0 === 'view')) {
        return { status: 0, stdout: '1.0.1' }
      }

      return { status: 0, stdout: 'foobar' }
    })

    // `_audit` now fetches over HTTP — stub it (async) to stay offline.
    lfAudit.mockResolvedValue(auditReport)
  })
  afterEach(() => {
    vi.clearAllMocks()
    lfAudit.mockResolvedValue(auditReport) // clearAllMocks keeps impls, but be explicit
  })
  afterAll(() => vi.restoreAllMocks())

  describe('createSymlinks', () => {
    it('establishes proper links', () => {
      const temp = 'foo/bar'
      const cwd = path.join(fixtures, 'regular-monorepo')
      const manifest = {
        workspaces: ['packages/*'],
      }

      createSymlinks({ temp, flags: {}, cwd, manifest } as unknown as TContext)

      const links = ['node_modules', 'packages/a', 'packages/b']
      links.forEach((link) => {
        expect(fs.symlinkSync).toHaveBeenCalledWith(
          path.join(cwd, link),
          strMatching(temp, link),
          'dir',
        )
      })
    })

    // Regression: nested workspaces (a package whose subtree holds more
    // packages) used to crash with `EEXIST` — symlinking the ancestor makes the
    // descendant's link path already resolve through it. Only the topmost link
    // should be created. https://github.com/antongolub/yarn-audit-fix (monorepo
    // field report: packages/stores/auth + packages/stores/auth/email).
    it('collapses nested workspaces to the topmost link (no EEXIST)', () => {
      const temp = 'foo/bar'
      const cwd = path.join(fixtures, 'nested-monorepo')
      const manifest = { workspaces: ['packages/**'] }

      createSymlinks({ temp, flags: {}, cwd, manifest } as unknown as TContext)

      // the ancestor workspace is linked...
      expect(fs.symlinkSync).toHaveBeenCalledWith(
        path.join(cwd, 'packages/stores/auth'),
        strMatching(temp, 'packages/stores/auth'),
        'dir',
      )
      // ...and the nested ones are NOT linked on top of it.
      expect(fs.symlinkSync).not.toHaveBeenCalledWith(
        path.join(cwd, 'packages/stores/auth/email'),
        expect.anything(),
        expect.anything(),
      )
      expect(fs.symlinkSync).not.toHaveBeenCalledWith(
        path.join(cwd, 'packages/stores/auth/phone'),
        expect.anything(),
        expect.anything(),
      )
    })
  })

  describe('runner', () => {
    // eslint-disable-next-line
    const checkTempAssets = () => {
      // Preparing...
      expect(fs.rmSync).toHaveBeenCalledWith(temp, {
        recursive: true,
        force: true,
      })
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(cwd, 'yarn.lock'),
        strMatching(temp, 'yarn.lock'),
      )
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(cwd, 'package.json'),
        strMatching(temp, 'package.json'),
      )
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(cwd, '.yarnrc'),
        strMatching(temp, '.yarnrc'),
      )
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        path.join(cwd, '.npmrc'),
        strMatching(temp, '.npmrc'),
      )
      expect(fs.symlinkSync).toHaveBeenCalledWith(
        path.join(cwd, 'node_modules'),
        strMatching(temp, 'node_modules'),
        'dir',
      )
    }
    it('throws error on broken package structure', async () => {
      fs.existsSync
        // @ts-ignore
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)

      await expect(run({ cwd: 'unknown' })).rejects.toEqual(
        new Error('not found: yarn.lock'),
      )
    })

    describe('`patch` flow', () => {
      it('invokes cmd queue with proper args', async () => {
        await run({
          temp,
        })

        checkTempAssets()

        // Patching `yarn.lock`
        expect(lfParse).toHaveBeenCalledWith(
          expect.any(String),
          'yarn-classic',
          expect.any(String),
        )
        // _audit fetches advisories over HTTP now (stubbed) — no `yarn audit` spawn.
        expect(lfAudit).toHaveBeenCalledTimes(1)
        expect(lfPatch).toHaveBeenCalledTimes(1)
        expect(lfFormat).toHaveBeenCalledTimes(1)
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          strMatching(temp, 'yarn.lock'),
          yarnLockAfter,
        )

        // Replaces original file, triggers `yarn --update-checksums`, resets temp directory
        expect(fs.copyFileSync).toHaveBeenCalledWith(
          strMatching(temp, 'yarn.lock'),
          'yarn.lock',
        )
        expect(cp.spawnSync).toHaveBeenCalledWith(
          getYarn(),
          ['install', '--update-checksums'],
          { cwd, stdio, shell },
        )
      })
    })

    describe('cli', () => {
      it('invokes cmd queue with proper args', async () => {
        process.argv.push(
          '--verbose',
          `--temp=${temp}`,
          `--registry=${registryUrl}`,
          `--exclude=${dependency}`,
          `--exclude=${scopedDependency}`,
          '--ignore-engines',
        )
        await import('../../main/ts/cli')
        // cli now fires run() asynchronously (fire-and-forget); let it settle.
        await new Promise((r) => setTimeout(r, 100))

        checkTempAssets()

        // Audit + patch the lockfile graph
        expect(lfAudit).toHaveBeenCalledTimes(1)
        expect(lfPatch).toHaveBeenCalledTimes(1)
        expect(lfFormat).toHaveBeenCalledTimes(1)

        // Replace the original lockfile, then install with flag-derived args
        expect(fs.copyFileSync).toHaveBeenCalledWith(
          strMatching(temp, 'yarn.lock'),
          'yarn.lock',
        )
        expect(cp.spawnSync).toHaveBeenCalledWith(
          getYarn(),
          [
            'install',
            '--update-checksums',
            '--verbose',
            '--registry',
            registryUrl,
            '--ignore-engines',
          ],
          { cwd, stdio, shell },
        )
      })

      describe('on error', () => {
        // Drive run() with a failing spawn (resolveBins fails first) so the
        // error/exit path is exercised.
        const checkExit = async (reason: any): Promise<void> => {
          // @ts-ignore
          vi.mocked(cp.spawnSync).mockImplementation(() => reason)
          await run({}).catch(() => {
            /* expected */
          })
        }

        it('sets code to 1 otherwise', async () => {
          await checkExit({ error: new Error('foobar') })
          expect(process.exitCode).toBe(1)
          process.exitCode = 0
        })

        it('returns exit code if passed', async () => {
          await checkExit({ status: 2 })
          expect(process.exitCode).toBe(2)
          process.exitCode = 0
        })
      })
    })
  })

  describe('#getContext', () => {
    it('parses flags, returns ctx entry', () => {
      const cwd = '/foo/bar'
      const bar = 'baz'
      const ctx = getContext({
        cwd,
        bar,
      })

      expect(ctx).toEqual(
        expect.objectContaining({
          cwd,
          flags: { cwd, bar },
          manifest: { version: '1.0.0' },
        }),
      )
    })
  })

})
