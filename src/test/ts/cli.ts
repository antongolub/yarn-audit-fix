import { describe, expect, it, vi } from 'vitest'

// Importing cli runs its bootstrap IIFE → keep run() inert so it has no effect.
vi.mock('../../main/ts/runner', () => ({ run: vi.fn(async () => undefined) }))

const { parse } = await import('../../main/ts/cli')

describe('cli parse', () => {
  it('parses value + boolean flags', () => {
    expect(parse(['--audit-level=high', '--force'])).toMatchObject({
      'audit-level': 'high',
      force: true,
    })
  })

  it('falls back to YAF_* env vars', () => {
    expect(parse([], { YAF_AUDIT_LEVEL: 'low' })).toMatchObject({ 'audit-level': 'low' })
  })

  it('short-circuits --version and --help', () => {
    expect(parse(['-v'])).toEqual({ version: true })
    expect(parse(['--help'])).toEqual({ help: true })
  })

  it('throws on an out-of-range choice', () => {
    expect(() => parse(['--audit-level=bogus'])).toThrow(/Invalid value for --audit-level/)
  })
})
