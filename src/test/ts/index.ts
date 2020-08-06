import cp from 'child_process'
import fs from 'fs-extra'
import synp from 'synp'
import findCacheDir from 'find-cache-dir'
import {join} from 'path'
import {run} from '../../main/ts'

jest.mock('child_process')
jest.mock('fs-extra')
jest.mock('synp')

const stdio = ['inherit', 'inherit', 'inherit']

describe('yarn-audit-fix', () => {

  beforeAll(() => {
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
  afterAll(jest.clearAllMocks)

  describe('runner', () => {
    it('invokes cmd queue with proper args', async() => {
      const temp = findCacheDir({name: 'yarn-audit-fix', create: true}) + ''
      const cwd = process.cwd()

      await run()

      // Preparing...
      expect(fs.emptyDirSync).toHaveBeenCalledWith(temp)
      expect(fs.copyFileSync).toHaveBeenCalledWith('yarn.lock', join(temp, 'yarn.lock'))
      expect(fs.copyFileSync).toHaveBeenCalledWith('package.json', join(temp, 'package.json'))
      expect(fs.createSymlinkSync).toHaveBeenCalledWith('node_modules', join(temp, 'node_modules'), 'dir')

      // Generating package-lock.json from yarn.lock...
      expect(fs.writeFileSync).toHaveBeenCalledWith(join(temp, 'package.json'), '{}')
      expect(fs.removeSync).toHaveBeenCalledWith(join(temp, 'yarn.lock'))

      // Applying npm audit fix...
      expect(cp.spawnSync).toHaveBeenCalledWith('npm', ['audit', 'fix', '--package-lock-only'], {cwd: temp, stdio})

      // Updating yarn.lock from package-lock.json...
      expect(cp.spawnSync).toHaveBeenCalledWith('yarn', ['import'], {cwd: temp, stdio})
      expect(fs.copyFileSync).toHaveBeenCalledWith(join(temp, 'yarn.lock'), 'yarn.lock')
      expect(cp.spawnSync).toHaveBeenCalledWith('yarn', [], {cwd, stdio})
      expect(fs.emptyDirSync).toHaveBeenCalledWith(temp)
    })

    it('throws exception if occurs', async() => {
      let reason = {error: new Error('foobar')} as any
      // @ts-ignore
      cp.spawnSync.mockImplementation(() => reason)
      await expect(run()).rejects.toBe(reason)

      reason = {status: 1}
      // @ts-ignore
      cp.spawnSync.mockImplementation(() => reason)
      await expect(run()).rejects.toBe(reason)
    })
  })
})
