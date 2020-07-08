import cp from 'child_process'

jest.mock('child_process')

beforeAll(() => {
  // @ts-ignore
  cp.spawnSync.mockImplementation(() => {})
})
afterAll(jest.clearAllMocks)

describe('yarn-audit-fix', () => {
  describe('runner', () => {
    it('invokes cmd queue with proper args', () => {
      require('../../main/ts/cli')

      expect(cp.spawnSync).toHaveBeenCalledWith('npm', ['i', '--package-lock-only'])
      expect(cp.spawnSync).toHaveBeenCalledWith('npm', ['audit', 'fix'])
      expect(cp.spawnSync).toHaveBeenCalledWith('rm', ['yarn.lock'])
      expect(cp.spawnSync).toHaveBeenCalledWith('yarn', ['import'])
      expect(cp.spawnSync).toHaveBeenCalledWith('rm', ['package-lock.json'])
    })
  })
})
