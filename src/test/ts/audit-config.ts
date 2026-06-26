import fs from 'node:fs'
import os from 'node:os'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_REGISTRY, resolveRegistryConfig } from '../../main/ts/audit/config'

const CWD = '/proj'
const realRead = fs.readFileSync

// Build a config hermetically from canned file contents — no real fs, no real
// $HOME (homedir points at a nonexistent dir so global config can't leak in).
const cfg = (files: Record<string, string>, flags: Record<string, any> = {}) => {
  vi.spyOn(os, 'homedir').mockReturnValue('/nonexistent-home-xyz')
  // @ts-ignore — overloaded signature
  vi.spyOn(fs, 'readFileSync').mockImplementation((p: any, ...rest: any[]) =>
    String(p) in files ? files[String(p)] : (realRead as any)(p, ...rest),
  )
  return resolveRegistryConfig(CWD, flags)
}

afterEach(() => vi.restoreAllMocks())

describe('resolveRegistryConfig', () => {
  it('defaults to the npm registry with no config', () => {
    const c = cfg({})
    expect(c.registryFor('lodash')).toBe(DEFAULT_REGISTRY)
    expect(c.registryFor('@scope/pkg')).toBe(DEFAULT_REGISTRY)
    expect(c.tokenFor(DEFAULT_REGISTRY)).toBeUndefined()
  })

  it('routes scoped packages to their @scope:registry, others to default (.npmrc)', () => {
    const c = cfg({
      [`${CWD}/.npmrc`]:
        '@acme:registry=https://npm.acme.com\nregistry=https://reg.example.com',
    })
    expect(c.registryFor('@acme/widget')).toBe('https://npm.acme.com')
    expect(c.registryFor('lodash')).toBe('https://reg.example.com')
    expect(c.registryFor('@other/x')).toBe('https://reg.example.com')
  })

  // THE security invariant: a token is bound to its declaring host and never
  // leaks to another registry.
  it('binds a token to its declaring host — no cross-registry leak', () => {
    const c = cfg({
      [`${CWD}/.npmrc`]:
        '//npm.acme.com/:_authToken=ACME_SECRET\n//other.com/:_authToken=OTHER',
    })
    expect(c.tokenFor('https://npm.acme.com')).toBe('ACME_SECRET')
    expect(c.tokenFor('https://other.com')).toBe('OTHER')
    expect(c.tokenFor('https://evil.example.com')).toBeUndefined()
    expect(c.tokenFor(DEFAULT_REGISTRY)).toBeUndefined()
  })

  it('matches the longest (most specific) token prefix', () => {
    const c = cfg({
      [`${CWD}/.npmrc`]:
        '//reg.com/:_authToken=ROOT\n//reg.com/team/:_authToken=TEAM',
    })
    expect(c.tokenFor('https://reg.com/team/pkg')).toBe('TEAM')
    expect(c.tokenFor('https://reg.com/other')).toBe('ROOT')
  })

  it('binds a bare _authToken to the default registry host only', () => {
    const c = cfg({ [`${CWD}/.npmrc`]: 'registry=https://reg.com\n_authToken=BARE' })
    expect(c.tokenFor('https://reg.com')).toBe('BARE')
    expect(c.tokenFor('https://elsewhere.com')).toBeUndefined()
  })

  it('expands ${ENV} in values and ignores non-http(s) registries', () => {
    process.env.YAF_CFG_TEST_TOKEN = 'FROM_ENV'
    try {
      const c = cfg({
        [`${CWD}/.npmrc`]:
          '//reg.com/:_authToken=${YAF_CFG_TEST_TOKEN}\nregistry=ftp://nope',
      })
      expect(c.tokenFor('https://reg.com')).toBe('FROM_ENV')
      expect(c.registryFor('x')).toBe(DEFAULT_REGISTRY) // ftp:// rejected
    } finally {
      delete process.env.YAF_CFG_TEST_TOKEN
    }
  })

  it('reads .yarnrc.yml npmScopes registry + npmRegistries auth (yarn berry)', () => {
    const c = cfg({
      [`${CWD}/.yarnrc.yml`]:
        'npmScopes:\n' +
        '  acme:\n' +
        '    npmRegistryServer: "https://npm.acme.com"\n' +
        'npmRegistries:\n' +
        '  "//npm.acme.com":\n' +
        '    npmAuthToken: "YML_TOKEN"\n',
    })
    expect(c.registryFor('@acme/x')).toBe('https://npm.acme.com')
    expect(c.tokenFor('https://npm.acme.com')).toBe('YML_TOKEN')
  })

  it('--registry flag overrides config', () => {
    const c = cfg(
      { [`${CWD}/.npmrc`]: 'registry=https://from-file.com' },
      { registry: 'https://from-flag.com' },
    )
    expect(c.registryFor('x')).toBe('https://from-flag.com')
  })

  it('project config wins over global (first writer)', () => {
    const c = cfg({
      [`${CWD}/.npmrc`]: 'registry=https://project.com',
      ['/nonexistent-home-xyz/.npmrc']: 'registry=https://global.com',
    })
    expect(c.registryFor('x')).toBe('https://project.com')
  })
})
