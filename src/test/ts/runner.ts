import cp from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const lf = (await import('../../main/ts/lockfile'))._internal
const { getContext, run } = await import('../../main/ts')
const { getYarn } = await import('../../main/ts/util')
const { parseAuditReport: parseAuditV1 } = await import('../../main/ts/audit/v1')

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
// `_audit` / `_patch` hit the registry over HTTP now; stub them so this flow
// test stays offline + deterministic. Patch correctness lives in lockfile.ts.
const auditReport = parseAuditV1(String((audit as any).stdout ?? ''))

const cwd = process.cwd()
const shell = true
const stdio = ['inherit', 'inherit', 'inherit']

const lfAudit = vi.spyOn(lf, '_audit')
const lfParse = vi.spyOn(lf, '_parse')
const lfPatch = vi.spyOn(lf, '_patch')
const lfFormat = vi.spyOn(lf, '_format')

describe('yarn-audit-fix', () => {
  beforeAll(() => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(noop)
    vi.spyOn(fs, 'existsSync').mockImplementation(() => true)
    // @ts-ignore
    vi.spyOn(fs, 'readFileSync').mockImplementation((name: any, ...rest: any[]) => {
      const s = String(name)
      // Only stub the project's own files; delegate everything else (vitest
      // module sources, node_modules, etc.) to the real fs.
      if (!s.includes('node_modules')) {
        const _name = path.basename(s)
        if (_name === 'yarn.lock') return yarnLockBefore
        if (_name === 'package.json') return '{"version": "1.0.0"}'
      }
      // @ts-ignore
      return realReadFileSync(name, ...rest)
    })
    // @ts-ignore
    vi.spyOn(cp, 'spawnSync').mockImplementation((cmd: string, [$0]: string[]) => {
      if ($0 === '--version' || (cmd === 'npm' && $0 === 'view')) {
        return { status: 0, stdout: '1.0.1' }
      }
      return { status: 0, stdout: 'foobar' }
    })

    lfAudit.mockResolvedValue(auditReport)
    lfPatch.mockImplementation(async (graph: any) => graph)
  })
  afterEach(() => {
    vi.clearAllMocks()
    lfAudit.mockResolvedValue(auditReport)
    lfPatch.mockImplementation(async (graph: any) => graph)
  })
  afterAll(() => vi.restoreAllMocks())

  describe('runner', () => {
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
      it('patches the real lockfile in place, then installs', async () => {
        await run({})

        // parse → audit → patch → format, all once; the lockfile is read and
        // (re)written in place under cwd — no temp copy / symlink dance.
        expect(lfParse).toHaveBeenCalledWith(
          expect.any(String),
          'yarn-classic',
          expect.any(String),
        )
        expect(lfAudit).toHaveBeenCalledTimes(1)
        expect(lfPatch).toHaveBeenCalledTimes(1)
        expect(lfFormat).toHaveBeenCalledTimes(1)
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          path.join(cwd, 'yarn.lock'),
          expect.any(String),
        )
        expect(cp.spawnSync).toHaveBeenCalledWith(
          getYarn(),
          ['install', '--update-checksums', '--ignore-engines'],
          { cwd, stdio, shell },
        )
      })
    })

    describe('cli', () => {
      it('invokes the flow with flag-derived install args', async () => {
        process.argv.push(
          '--verbose',
          `--registry=${registryUrl}`,
          `--exclude=${dependency}`,
          `--exclude=${scopedDependency}`,
        )
        await import('../../main/ts/cli')
        // cli fires run() asynchronously (fire-and-forget); let it settle.
        await new Promise((r) => setTimeout(r, 100))

        expect(lfAudit).toHaveBeenCalledTimes(1)
        expect(lfPatch).toHaveBeenCalledTimes(1)
        expect(lfFormat).toHaveBeenCalledTimes(1)
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
      const ctx = getContext({ cwd, bar })

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
