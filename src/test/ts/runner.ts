import cp from 'child_process'
import findCacheDir from 'find-cache-dir'
import fs from 'fs-extra'
import { factory as iop } from 'inside-out-promise'
import { join, resolve } from 'path'
import synp from 'synp'

import {createSymlinks, run, TContext} from '../../main/ts'
import { getNpm, getYarn } from '../../main/ts/util'
import lf from '../../main/ts/lockfile'

jest.mock('child_process')
jest.mock('fs-extra')
jest.mock('npm')
jest.mock('synp')
jest.mock('../../main/ts/lockfile')

const noop = () => { /* noop */ }
const registryUrl = 'https://example.com'
const strMatching = (start: string = '', end: string = '') =>
  expect.stringMatching(new RegExp(`^${start}.+${end}$`))

describe('yarn-audit-fix', () => {
  beforeEach(() => {
    // @ts-ignore
    lf.audit.mockImplementation(noop)
    // @ts-ignore
    lf.parch.mockImplementation(noop)
    // @ts-ignore
    lf.read.mockImplementation(noop)
    // @ts-ignore
    lf.write.mockImplementation(noop)
    // @ts-ignore
    fs.emptyDirSync.mockImplementation(noop)
    // @ts-ignore
    fs.copyFileSync.mockImplementation(noop)
    // @ts-ignore
    fs.readFileSync.mockImplementation(() => '{"version": "1.0.0"}')
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
    cp.spawnSync.mockImplementation(() => ({ status: 0, stdout: '1.0.1' }))
  })
  afterEach(jest.clearAllMocks)
  afterAll(jest.resetAllMocks)

  describe('createSymlinks', () => {
    it('establishes proper links', () => {
      const temp = 'foo/bar'
      const cwd = resolve(__dirname, '../fixtures/regular-monorepo')
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
    it('throws error on unsupported flow', async () =>
      expect(run({flow: 'unknown'})).rejects.toEqual(new Error('Unsupported flow: unknown'))
    )

    // eslint-disable-next-line
    const checkConvertFlow = (skipPkgLockOnly?: boolean) => {
      const temp = findCacheDir({ name: 'yarn-audit-fix', create: true }) + ''
      const cwd = process.cwd()
      const stdio = ['inherit', 'inherit', 'inherit']

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
        ['--update-checksums', '--verbose', '--registry', registryUrl],
        { cwd, stdio },
      )
      expect(fs.emptyDirSync).toHaveBeenCalledWith(expect.stringMatching(temp))
    }

    describe('`patch` flow', () => {
      fit('invokes cmd queue with proper args', async () => {
        await run({
          flow: 'patch',
        })

        const temp = findCacheDir({ name: 'yarn-audit-fix', create: true }) + ''
        const cwd = process.cwd()
        const stdio = ['inherit', 'inherit', 'inherit']

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

        // Generating package-lock.json from yarn.lock...
        expect(synp.yarnToNpm).toHaveBeenCalledWith(strMatching(temp), true)
        expect(fs.removeSync).toHaveBeenCalledWith(strMatching(temp, 'yarn.lock'))
      })
    })

    describe('`convert` flow', () => {
      it('invokes cmd queue with proper args', async () => {
        await run({
          verbose: true,
          foo: 'bar',
          'package-lock-only': true,
          registry: registryUrl,
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
          )
          require('../../main/ts/cli')
        })
        checkConvertFlow(true)
      })

      describe('on error', () => {
        // eslint-disable-next-line
        const checkExit = (reason: any): Promise<any> => {
          const { promise, resolve } = iop()

          // @ts-ignore
          cp.spawnSync.mockImplementationOnce(() => {
            setImmediate(resolve)

            return reason
          })

          jest.isolateModules(() => require('../../main/ts/cli'))

          return promise
        }

        it('returns exit code if passed', async () => {
          await expect(checkExit({ status: 2 })).rejects
          expect(process.exitCode).toBe(2)
        })

        it('sets code to 1 otherwise', async () => {
          await expect(checkExit({ error: new Error('foobar') })).rejects
          expect(process.exitCode).toBe(1)
        })
      })
    })
  })
})
