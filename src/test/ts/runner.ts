import cp from 'child_process'
import findCacheDir from 'find-cache-dir'
import fs from 'fs-extra'
import { basename, join, resolve } from 'path'
import synp from 'synp'

import { createSymlinks, run, TContext, TFlow } from '../../main/ts'
import * as lf from '../../main/ts/lockfile'
import { getNpm, getYarn } from '../../main/ts/util'

jest.mock('child_process')
jest.mock('fs-extra')
jest.mock('npm')
jest.mock('synp')

const noop = () => {
  /* noop */
}
const fixtures = resolve(__dirname, '../fixtures')
const registryUrl = 'https://example.com'
const strMatching = (start = '', end = '') =>
  expect.stringMatching(new RegExp(`^${start}.+${end}$`))
const readFixture = (name: string): string =>
  jest.requireActual('fs').readFileSync(resolve(fixtures, name), {
    encoding: 'utf-8',
  })
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
const audit = revive(readFixture('lockfile/yarn-audit-report.json'))
const yarnLockBefore = readFixture('lockfile/yarn.lock.before')
const yarnLockAfter = readFixture('lockfile/yarn.lock.after')

const temp = findCacheDir({ name: 'yarn-audit-fix', create: true }) + ''
const cwd = process.cwd()
const stdio = ['inherit', 'inherit', 'inherit']
const stdionull = [null, null, null] // eslint-disable-line

const lfAudit = jest.spyOn(lf, 'audit')
const lfRead = jest.spyOn(lf, 'read')
const lfPatch = jest.spyOn(lf, 'patch')
const lfWrite = jest.spyOn(lf, 'write')

describe('yarn-audit-fix', () => {
  beforeEach(() => {
    // @ts-ignore
    fs.emptyDirSync.mockImplementation(noop)
    // @ts-ignore
    fs.copyFileSync.mockImplementation(noop)
    // @ts-ignore
    fs.readFileSync.mockImplementation((name) => {
      const _name = basename(name)

      if (_name === 'yarn.lock') {
        return yarnLockBefore
      }

      if (_name === 'package.json') {
        return '{"version": "1.0.0"}'
      }

      return ''
    })
    // @ts-ignore
    fs.removeSync.mockImplementation(noop)
    // @ts-ignore
    fs.existsSync.mockImplementation(() => true)
    // @ts-ignore
    fs.createSymlinkSync.mockImplementation(noop)
    // @ts-ignore
    synp.yarnToNpm.mockImplementation(() => '{}')
    // @ts-ignore
    synp.npmToYarn.mockImplementation(() => '{}')
    // @ts-ignore
    cp.spawnSync.mockImplementation((cmd, [$0, $1]) => {
      if ($0 === 'audit' && $1 === '--json') {
        return audit
      }

      return { status: 0, stdout: '1.0.1' }
    })
  })
  afterEach(jest.clearAllMocks)
  afterAll(jest.resetAllMocks)

  describe('createSymlinks', () => {
    it('establishes proper links', () => {
      const temp = 'foo/bar'
      const cwd = join(fixtures, 'regular-monorepo')
      const manifest = {
        workspaces: ['packages/*'],
      }

      createSymlinks({ temp, flags: {}, cwd, manifest } as unknown as TContext)

      const links = ['node_modules', 'packages/a', 'packages/b']
      links.forEach((link) => {
        expect(fs.createSymlinkSync).toHaveBeenCalledWith(
          join(cwd, link),
          strMatching(temp, link),
          'dir',
        )
      })
    })
  })

  describe('runner', () => {
    // eslint-disable-next-line
    const checkTempAssets = () => {
      // Preparing...
      expect(fs.emptyDirSync).toHaveBeenCalledWith(expect.stringMatching(temp))
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        'yarn.lock',
        strMatching(temp, 'yarn.lock'),
      )
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        'package.json',
        strMatching(temp, 'package.json'),
      )
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        '.yarnrc',
        strMatching(temp, '.yarnrc'),
      )
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        '.npmrc',
        strMatching(temp, '.npmrc'),
      )
      expect(fs.createSymlinkSync).toHaveBeenCalledWith(
        join(cwd, 'node_modules'),
        strMatching(temp, 'node_modules'),
        'dir',
      )
    }
    // eslint-disable-next-line
    const checkConvertFlow = (skipPkgLockOnly?: boolean) => {
      checkTempAssets()

      // Generating package-lock.json from yarn.lock...
      expect(synp.yarnToNpm).toHaveBeenCalledWith(strMatching(temp), true)
      expect(fs.removeSync).toHaveBeenCalledWith(strMatching(temp, 'yarn.lock'))

      // Applying npm audit fix...
      expect(cp.spawnSync).toHaveBeenCalledWith(
        getNpm(),
        [
          'audit',
          'fix',
          skipPkgLockOnly ? undefined : '--package-lock-only',
          '--verbose',
          '--registry',
          registryUrl,
          '--prefix',
          expect.stringMatching(temp),
        ].filter((v) => v !== undefined),
        { cwd: expect.stringMatching(temp), stdio },
      )

      // Updating yarn.lock from package-lock.json...
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
        { cwd, stdio },
      )
      expect(fs.emptyDirSync).toHaveBeenCalledWith(expect.stringMatching(temp))
    }

    it('executes custom flows', async () => {
      const handler = jest.fn(noop)
      const flow: TFlow = {
        main: [['Test', handler]],
        fallback: [],
      }
      await run({}, flow)

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('throws error on unsupported flow', async () =>
      expect(run({ flow: 'unknown' })).rejects.toEqual(
        new Error('Unsupported flow: unknown'),
      ))

    describe('`patch` flow', () => {
      it('invokes cmd queue with proper args', async () => {
        await run({
          flow: 'patch',
        })

        checkTempAssets()

        // Patching `yarn.lock`
        expect(lfRead).toHaveBeenCalledWith(strMatching(temp, 'yarn.lock'))
        expect(lfAudit).toHaveBeenCalledTimes(1)
        expect(cp.spawnSync).toHaveBeenCalledWith(
          getYarn(),
          ['audit', '--json'],
          { cwd: strMatching(temp), stdio: stdionull },
        )
        expect(lfPatch).toHaveBeenCalledTimes(1)
        expect(lfWrite).toHaveBeenCalledTimes(1)
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
          { cwd, stdio },
        )
      })
    })

    describe('`convert` flow', () => {
      it('invokes cmd queue with proper args', async () => {
        await run({
          verbose: true,
          foo: 'bar',
          'package-lock-only': true,
          registry: registryUrl,
          flow: 'convert',
          ignoreEngines: true,
        })
        checkConvertFlow()
      })

      it('handles exceptions', async () => {
        let reason = { error: new Error('foobar') } as any
        // @ts-ignore
        cp.spawnSync.mockImplementation(() => reason)
        await expect(run({ silent: true })).rejects.toBe(reason)

        reason = { status: 1 }
        // @ts-ignore
        cp.spawnSync.mockImplementation(() => reason)
        await expect(run({ silent: true })).rejects.toBe(reason)

        reason = new TypeError('foo')
        // @ts-ignore
        cp.spawnSync.mockImplementation(() => {
          throw reason
        })
        await expect(run()).rejects.toBe(reason)
      })
    })

    describe('cli', () => {
      it('invokes cmd queue with proper args', () => {
        jest.isolateModules(() => {
          process.argv.push(
            '--verbose',
            '--package-lock-only=false',
            `--registry=${registryUrl}`,
            '--flow=convert',
            '--ignore-engines'
          )
          require('../../main/ts/cli')
        })
        checkConvertFlow(true)
      })

      describe('on error', () => {
        // eslint-disable-next-line
        const checkExit = (reason: any): void => {
          // @ts-ignore
          cp.spawnSync.mockImplementationOnce(() => reason)
          jest.isolateModules(() => {
            try {
              require('../../main/ts/cli')
            } catch {}
          })
        }

        it('returns exit code if passed', () => {
          checkExit({ status: 2 })
          expect(process.exitCode).toBe(2)
        })

        it('sets code to 1 otherwise', async () => {
          checkExit({ error: new Error('foobar') })
          expect(process.exitCode).toBe(1)
        })
      })
    })
  })
})
