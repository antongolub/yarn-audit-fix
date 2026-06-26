import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { TFlags } from '../ifaces'
import { attempt } from '../util'

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/**
 * Resolved registry routing + (host-scoped) auth, derived from `.npmrc` /
 * `.yarnrc.yml` / `.yarnrc` (project then global) + env + flags.
 *
 * SECURITY: auth tokens are kept **bound to the host (+ path prefix)** that
 * declared them, exactly like npm's `//host/path/:_authToken` semantics. A token
 * is only ever returned for a request URL whose host/path it actually covers, so
 * a credential for registry A can never leak to registry B.
 */
export type TRegistryConfig = {
  registryFor: (pkgName: string) => string
  tokenFor: (registryUrl: string) => string | undefined
}

type TAuthToken = { prefix: string; token: string } // prefix = `host/path` (no protocol)

// Object built with a null prototype + dangerous keys rejected — the config
// values come from on-disk files we don't fully trust, so guard against
// prototype pollution (`__proto__`, `constructor`, `prototype`).
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const safeSet = (o: Record<string, string>, k: string, v: string): void => {
  if (!UNSAFE_KEYS.has(k) && !(k in o)) o[k] = v // first writer wins (precedence)
}

// Only expand `${VAR}` against real, conservatively-named env vars — never eval.
const expandEnv = (v: string): string =>
  v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '')

const stripQuotes = (v: string): string =>
  v.replace(/^["']/, '').replace(/["']$/, '').trim()

// `https://host/path/` -> `host/path` (npm token-matching key: no protocol, no
// trailing slash). Used both for declared tokens and for the lookup URL.
const hostPathKey = (url: string): string => {
  const u = attempt(() => new URL(url))
  if (!u) return ''
  return (u.host + u.pathname).replace(/\/+$/, '')
}

const normalizeRegistry = (url: string): string => {
  const u = attempt(() => new URL(url))
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return ''
  return url.replace(/\/+$/, '')
}

// ---- .npmrc (INI: `key=value`) ----------------------------------------------
const parseNpmrc = (
  text: string,
  reg: { default?: string; scopes: Record<string, string> },
  tokens: TAuthToken[],
): void => {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = expandEnv(stripQuotes(line.slice(eq + 1)))
    if (!value) continue

    // `//host/path/:_authToken=…` (or `:_auth=`) — host-scoped credential.
    const auth = key.match(/^\/\/(.+?)\/?:(_authToken|_auth)$/)
    if (auth) {
      tokens.push({ prefix: auth[1].replace(/\/+$/, ''), token: value })
      continue
    }
    if (key === '_authToken' || key === '_auth') {
      // Bare token → bound to the default registry host (resolved later).
      tokens.push({ prefix: '', token: value })
      continue
    }
    if (key === 'registry') {
      const n = normalizeRegistry(value)
      if (n && reg.default === undefined) reg.default = n
      continue
    }
    const scoped = key.match(/^(@[^:]+):registry$/)
    if (scoped) {
      const n = normalizeRegistry(value)
      if (n) safeSet(reg.scopes, scoped[1], n)
    }
  }
}

// ---- .yarnrc.yml (minimal YAML subset — only the keys we need) --------------
const parseYarnrcYml = (
  text: string,
  reg: { default?: string; scopes: Record<string, string> },
  tokens: TAuthToken[],
): void => {
  const lines = text.split(/\r?\n/)
  let block: '' | 'npmScopes' | 'npmRegistries' = ''
  let subKey = '' // current scope name / `//host`
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    const kv = line.match(/^("?[^":]+"?)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = stripQuotes(kv[1])
    const val = expandEnv(stripQuotes(kv[2]))

    if (indent === 0) {
      block = key === 'npmScopes' || key === 'npmRegistries' ? key : ''
      subKey = ''
      if (key === 'npmRegistryServer' && val) {
        const n = normalizeRegistry(val)
        if (n && reg.default === undefined) reg.default = n
      }
      if (key === 'npmAuthToken' && val) tokens.push({ prefix: '', token: val })
      continue
    }
    if (indent === 2 && !val) {
      subKey = key // a scope name (npmScopes) or `//host` (npmRegistries)
      continue
    }
    if (indent >= 4 && subKey) {
      if (block === 'npmScopes' && key === 'npmRegistryServer' && val) {
        const n = normalizeRegistry(val)
        if (n) safeSet(reg.scopes, subKey.startsWith('@') ? subKey : `@${subKey}`, n)
      }
      if (block === 'npmRegistries' && key === 'npmAuthToken' && val) {
        // Yarn keys registries as `//host` (or `https://host`); strip the
        // protocol AND the `//` so the prefix matches `hostPathKey` (host/path,
        // no protocol) — otherwise the token never matches and is silently lost.
        tokens.push({
          prefix: subKey.replace(/^(https?:)?\/\//, '').replace(/\/+$/, ''),
          token: val,
        })
      }
    }
  }
}

// ---- .yarnrc (classic: `registry "url"`) ------------------------------------
const parseYarnrc = (
  text: string,
  reg: { default?: string; scopes: Record<string, string> },
): void => {
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^registry\s+(.+)$/)
    if (m && reg.default === undefined) {
      const n = normalizeRegistry(stripQuotes(m[1]))
      if (n) reg.default = n
    }
  }
}

const read = (p: string): string | undefined =>
  attempt(() => fs.readFileSync(p, 'utf8')) ?? undefined

export const resolveRegistryConfig = (
  cwd: string,
  flags: TFlags = {},
): TRegistryConfig => {
  const reg: { default?: string; scopes: Record<string, string> } = {
    scopes: Object.create(null),
  }
  const tokens: TAuthToken[] = []

  // Highest precedence first; first writer wins (safeSet / `=== undefined`).
  // 1. explicit flag / YAF_REGISTRY env
  const flagReg = normalizeRegistry(String(flags.registry ?? ''))
  if (flagReg) reg.default = flagReg
  // 2. env
  const envReg =
    normalizeRegistry(process.env.npm_config_registry ?? '') ||
    normalizeRegistry(process.env.YARN_NPM_REGISTRY_SERVER ?? '')
  if (envReg && reg.default === undefined) reg.default = envReg
  // 3. project files, then 4. global files
  const home = os.homedir()
  const projectNpmrc = read(path.join(cwd, '.npmrc'))
  const projectYarnYml = read(path.join(cwd, '.yarnrc.yml'))
  const projectYarnrc = read(path.join(cwd, '.yarnrc'))
  const globalNpmrc = read(path.join(home, '.npmrc'))
  const globalYarnYml = read(path.join(home, '.yarnrc.yml'))

  if (projectNpmrc) parseNpmrc(projectNpmrc, reg, tokens)
  if (projectYarnYml) parseYarnrcYml(projectYarnYml, reg, tokens)
  if (projectYarnrc) parseYarnrc(projectYarnrc, reg)
  if (globalNpmrc) parseNpmrc(globalNpmrc, reg, tokens)
  if (globalYarnYml) parseYarnrcYml(globalYarnYml, reg, tokens)

  const defaultRegistry = reg.default ?? DEFAULT_REGISTRY

  return {
    registryFor: (pkgName) => {
      if (pkgName.startsWith('@')) {
        const scope = pkgName.slice(0, pkgName.indexOf('/'))
        if (reg.scopes[scope]) return reg.scopes[scope]
      }
      return defaultRegistry
    },
    // Returns the token whose declared host/path prefix covers `registryUrl`.
    // The longest matching prefix wins (most specific credential).
    tokenFor: (registryUrl) => {
      const target = hostPathKey(registryUrl)
      if (!target) return undefined
      const defKey = hostPathKey(defaultRegistry)
      let best: TAuthToken | undefined
      for (const t of tokens) {
        const prefix = t.prefix || defKey // bare token → default registry host
        if (
          (target === prefix || target.startsWith(prefix + '/')) &&
          (!best || prefix.length > (best.prefix || defKey).length)
        ) {
          best = t
        }
      }
      return best?.token
    },
  }
}
