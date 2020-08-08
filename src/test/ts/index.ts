import cp from 'child_process'
import {join} from 'path'
import fs from 'fs-extra'
import synp from 'synp'
import findCacheDir from 'find-cache-dir'
import {factory as iop} from 'inside-out-promise'
import {run} from '../../main/ts'

jest.mock('child_process')
jest.mock('fs-extra')
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
    fs.createSymlinkSync.mockImplementation(() => { /* noop */ })
    // @ts-ignore
    synp.yarnToNpm.mockImplementation(() => '{}')
    // @ts-ignore
    cp.spawnSync.mockImplementation(() => ({status: 0, stdout: 'foobar'}))
  })
  afterEach(jest.clearAllMocks)
  afterAll(jest.resetAllMocks)

  describe('flow', () => {
    const checkFlow = () => {
      const temp = findCacheDir({name: 'yarn-audit-fix', create: true}) + ''
      const cwd = process.cwd()
      const stdio = ['inherit', 'inherit', 'inherit']

      // Preparing...
      expect(fs.emptyDirSync).toHaveBeenCalledWith(temp)
      expect(fs.copyFileSync).toHaveBeenCalledWith('yarn.lock', join(temp, 'yarn.lock'))
      expect(fs.copyFileSync).toHaveBeenCalledWith('package.json', join(temp, 'package.json'))
      expect(fs.createSymlinkSync).toHaveBeenCalledWith('node_modules', join(temp, 'node_modules'), 'dir')

      // Generating package-lock.json from yarn.lock...
      expect(fs.writeFileSync).toHaveBeenCalledWith(join(temp, 'package.json'), '{}')
      expect(fs.removeSync).toHaveBeenCalledWith(join(temp, 'yarn.lock'))

      // Applying npm audit fix...
      expect(cp.spawnSync).toHaveBeenCalledWith('npm', ['audit', 'fix', '--package-lock-only', '--verbose'], {cwd: temp, stdio})

      // Updating yarn.lock from package-lock.json...
      expect(cp.spawnSync).toHaveBeenCalledWith('yarn', ['import', '--verbose'], {cwd: temp, stdio})
      expect(fs.copyFileSync).toHaveBeenCalledWith(join(temp, 'yarn.lock'), 'yarn.lock')
      expect(cp.spawnSync).toHaveBeenCalledWith('yarn', ['--verbose'], {cwd, stdio})
      expect(fs.emptyDirSync).toHaveBeenCalledWith(temp)
    }

    describe('runner', () => {
      it('invokes cmd queue with proper args', async() => {
        await run({verbose: true, foo: 'bar'})
        checkFlow()
      })

      it('throws exception if occurs', async() => {
        let reason = {error: new Error('foobar')} as any
        // @ts-ignore
        cp.spawnSync.mockImplementation(() => reason)
        await expect(run({})).rejects.toBe(reason)

        reason = {status: 1}
        // @ts-ignore
        cp.spawnSync.mockImplementation(() => reason)
        await expect(run({})).rejects.toBe(reason)
      })
    })

    describe('cli', () => {
      it('invokes cmd queue with proper args', () => {
        jest.isolateModules(() => {
          process.argv.push('--verbose')
          require('../../main/ts/cli')
        })
        checkFlow()
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
