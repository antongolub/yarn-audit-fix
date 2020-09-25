import cp from 'child_process'
import {join} from 'path'
import fs from 'fs-extra'
import synp from 'synp'
import findCacheDir from 'find-cache-dir'
import {factory as iop} from 'inside-out-promise'
import {run} from '../../main/ts'
import {getYarn, getNpm} from '../../main/ts/util'

jest.mock('child_process')
jest.mock('fs-extra')
jest.mock('npm')
jest.mock('synp')

describe('yarn-audit-fix', () => {
  beforeEach(() => {
    // @ts-ignore
    jest.spyOn(process, 'exit').mockImplementation(() => { /* noop */ })
    // @ts-ignore
    fs.emptyDirSync.mockImplementation(() => { /* noop */ })
    // @ts-ignore
    fs.copyFileSync.mockImplementation(() => { /* noop */ })
    // @ts-ignore
    fs.readFileSync.mockImplementation(() => '{}')
    // @ts-ignore
    fs.removeSync.mockImplementation(() => { /* noop */ })
    // @ts-ignore
    fs.existsSync.mockImplementation(() => true)
    // @ts-ignore
    fs.createSymlinkSync.mockImplementation(() => { /* noop */ })
    // @ts-ignore
    synp.yarnToNpm.mockImplementation(() => '{}')
    // @ts-ignore
    synp.npmToYarn.mockImplementation(() => '{}')
    // @ts-ignore
    cp.spawnSync.mockImplementation(() => ({status: 0, stdout: 'foobar'}))
  })
  afterEach(jest.clearAllMocks)
  afterAll(jest.resetAllMocks)

  describe('flow', () => {
    const checkFlow = (skipPkgLockOnly?: boolean) => {
      const temp = findCacheDir({name: 'yarn-audit-fix', create: true}) + ''
      const cwd = process.cwd()
      const stdio = ['inherit', 'inherit', 'inherit']

      // Preparing...
      expect(fs.emptyDirSync).toHaveBeenCalledWith(temp)
      expect(fs.copyFileSync).toHaveBeenCalledWith('yarn.lock', join(temp, 'yarn.lock'))
      expect(fs.copyFileSync).toHaveBeenCalledWith('package.json', join(temp, 'package.json'))
      expect(fs.copyFileSync).toHaveBeenCalledWith('.yarnrc', join(temp, '.yarnrc'))
      expect(fs.copyFileSync).toHaveBeenCalledWith('.npmrc', join(temp, '.npmrc'))
      expect(fs.createSymlinkSync).toHaveBeenCalledWith(join(cwd, 'node_modules'), join(temp, 'node_modules'), 'dir')

      // Generating package-lock.json from yarn.lock...
      expect(fs.removeSync).toHaveBeenCalledWith(join(temp, 'yarn.lock'))

      // Applying npm audit fix...
      expect(cp.spawnSync).toHaveBeenCalledWith(getNpm(), ([
        'audit',
        'fix',
        skipPkgLockOnly ? null : '--package-lock-only',
        '--verbose',
        '--registry', 'https://example.com',
        '--prefix', temp,
      ]).filter(v => v !== null), {cwd: temp, stdio})

      // Updating yarn.lock from package-lock.json...
      expect(fs.copyFileSync).toHaveBeenCalledWith(join(temp, 'yarn.lock'), 'yarn.lock')
      expect(cp.spawnSync).toHaveBeenCalledWith(getYarn(), ['--update-checksums', '--verbose', '--registry', 'https://example.com'], {cwd, stdio})
      expect(fs.emptyDirSync).toHaveBeenCalledWith(temp)
    }

    describe('runner', () => {
      it('invokes cmd queue with proper args', async() => {
        await run({verbose: true, foo: 'bar', ['package-lock-only']: true, registry: 'https://example.com'})
        checkFlow()
      })

      it('handles exceptions', async() => {
        let reason = {error: new Error('foobar')} as any
        // @ts-ignore
        cp.spawnSync.mockImplementation(() => reason)
        await expect(run({silent: true})).rejects.toBe(reason)

        reason = {status: 1}
        // @ts-ignore
        cp.spawnSync.mockImplementation(() => reason)
        await expect(run({silent: true})).rejects.toBe(reason)

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
          process.argv.push('--verbose', '--package-lock-only=false', '--registry=https://example.com')
          require('../../main/ts/cli')
        })
        checkFlow(true)
      })

      describe('on error', () => {
        const checkExit = (reason: any, code: number): Promise<any> => {
          const {promise, resolve} = iop()
          // @ts-ignore
          cp.spawnSync.mockImplementationOnce(() => {
            setImmediate(() => {
              expect(process.exit).toHaveBeenCalledWith(code)
              // @ts-ignore
              resolve()
            })

            return reason
          })

          jest.isolateModules(() => require('../../main/ts/cli'))

          return promise
        }

        it('returns exit code if passed', async() => {
          await checkExit({status: 2}, 2)
        })

        it('sets code to 1 otherwise', async() => {
          await checkExit({error: new Error('foobar')}, 1)
        })
      })
    })
  })
})
