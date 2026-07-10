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

  it('lifts the minimist-nested --engines.<engine> object across the allowlist', () => {
    expect(parse(['--engines.node=>=18'])).toMatchObject({ engines: { node: '>=18' } })
    // bare engine → true (→ runtime, resolved later); a second engine with a range
    expect(parse(['--engines.node', '--engines.npm=>=9'])).toMatchObject({
      engines: { node: true, npm: '>=9' },
    })
  })

  it('omits `engines` when no --engines.<engine> is passed', () => {
    expect(parse(['--force'])).not.toHaveProperty('engines')
  })

  it('parses --on-conflict and enforces its choices', () => {
    expect(parse(['--on-conflict=stop'])).toMatchObject({ 'on-conflict': 'stop' })
    expect(parse(['--on-conflict=skip'])).toMatchObject({ 'on-conflict': 'skip' })
    expect(() => parse(['--on-conflict=bogus'])).toThrow(/Invalid value for --on-conflict/)
  })
})
