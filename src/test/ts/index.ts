import cp from 'child_process'

jest.mock('child_process')

beforeAll(() => {
  // @ts-ignore
  cp.spawnSync.mockImplementation(() => { /* noop */ })
})
afterAll(jest.clearAllMocks)

describe('yarn-audit-fix', () => {
  describe('runner', () => {
    it('invokes cmd queue with proper args', () => {
      require('../../main/ts/cli')

      expect(cp.spawnSync).toHaveBeenCalledWith('node_modules/.bin/synp', ['-s', 'yarn.lock'])
      expect(cp.spawnSync).toHaveBeenCalledWith('node_modules/.bin/rimraf', ['yarn.lock'])
      expect(cp.spawnSync).toHaveBeenCalledWith('npm', ['audit', 'fix', '--package-lock-only'])
      expect(cp.spawnSync).toHaveBeenCalledWith('node_modules/.bin/synp', ['-s', 'package-lock.json'])
      expect(cp.spawnSync).toHaveBeenCalledWith('node_modules/.bin/rimraf', ['package-lock.json'])
    })
  })
})
