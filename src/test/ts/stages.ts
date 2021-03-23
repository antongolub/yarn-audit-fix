import { checkFlags } from '../../main/ts'

describe('stages', () => {
  const ctx = {
    flags: {},
    cwd: '',
    temp: '',
    manifest: {}
  }

  describe('cliGuard', () => {
    it('raises error for unsupported flags', () => {
      expect(() => checkFlags({ ...ctx, flags: { foo: 'bar'}} )).toThrowError('Unsupported flag: foo')
    })

    it('suppresses error if `skip-cli-check` passed', () => {
      expect(checkFlags({ ...ctx, flags: { foo: 'bar', 'skip-cli-check': true}} )).toBeUndefined()
    })

    it('returns undefined if flags are valid', () => {
      expect(checkFlags({ ...ctx, flags: { 'npm-path': 'bar', silent: true, _: []}} )).toBeUndefined()
    })
  })
})
