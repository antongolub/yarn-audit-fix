import cp from 'child_process'
import fs from 'fs-extra'
import synp from 'synp'
import {run} from '../../main/ts'

jest.mock('child_process')
jest.mock('fs-extra')
jest.mock('synp')

describe('yarn-audit-fix', () => {

  beforeAll(() => {
    // @ts-ignore
    fs.copyFileSync.mockImplementation(() => { /* noop */ })
    // @ts-ignore
    fs.readFileSync.mockImplementation(() => '{}')
    // @ts-ignore
    fs.removeSync.mockImplementation(() => { /* noop */ })
    // @ts-ignore
    synp.yarnToNpm.mockImplementation(() => '{}')
    // @ts-ignore
    cp.spawnSync.mockImplementation(() => ({status: 0, stdout: 'foobar'}))
  })
  afterAll(jest.clearAllMocks)

  describe('runner', () => {
    it('invokes cmd queue with proper args', async() => {
      const expectedOpts = {cwd: process.cwd()}

      await require('../../main/ts/cli')

      // Generating package-lock.json from yarn.lock...
      expect(cp.spawnSync).toHaveBeenCalledWith('yarn', [], expectedOpts)
      expect(fs.copyFileSync).toHaveBeenCalledWith('package.json', 'origin.package.json')
      expect(fs.writeFileSync).toHaveBeenCalledWith('package.json', '{}')

      // Applying npm audit fix...
      expect(cp.spawnSync).toHaveBeenCalledWith('npm', ['audit', 'fix', '--package-lock-only'], expectedOpts)

      // Updating yarn.lock from package-lock.json...
      expect(cp.spawnSync).toHaveBeenCalledWith('yarn', ['import'], expectedOpts)
      expect(fs.copyFileSync).toHaveBeenCalledWith('origin.package.json', 'package.json')
      expect(fs.removeSync).toHaveBeenCalledWith('origin.package.json')
      expect(fs.removeSync).toHaveBeenCalledWith('package-lock.json')
    })

    it('throws exception if occurs', async() => {
      // @ts-ignore
      cp.spawnSync.mockImplementation(() => ({error: new Error('foobar')}))

      await expect(run()).rejects.toThrow('foobar')

      // @ts-ignore
      cp.spawnSync.mockImplementation(() => ({status: 1}))

      await expect(run()).rejects.toThrowError()
    })
  })
})
