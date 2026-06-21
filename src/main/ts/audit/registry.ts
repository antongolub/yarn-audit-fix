import http from 'node:http'
import https from 'node:https'

import type { Graph } from '@antongolub/lockfile'
import sv from 'semver'

import { TAuditReport, TContext } from '../ifaces'
import { resolveRegistryConfig, TRegistryConfig } from './config'
import { matchesId, parseIdGlobs } from './filter'
import { extractRefs, mergeMeta } from './meta'
import { derivePatchedVersions } from './v4'

const BULK_PATH = '/-/npm/v1/security/advisories/bulk'
const CHUNK = 250 // packages per bulk request — large graphs go in several requests
const TIMEOUT_MS = 30_000

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
}
const rank = (s?: string): number => SEVERITY_RANK[String(s ?? 'info')] ?? 0

const scrub = (msg: string, token?: string): string =>
  token ? msg.split(token).join('***') : msg

/** `{ name: [versions] }` for real npm packages — skips workspaces and any node
 *  whose version isn't plain semver (workspace/link/portal/exec locators). */
export const collectPackages = (graph: Graph): Record<string, string[]> => {
  const acc: Record<string, Set<string>> = Object.create(null)
  for (const node of graph.nodes()) {
    if (node.workspacePath) continue
    if (!node.name || node.name === '__proto__') continue
    if (!sv.valid(node.version)) continue
    ;(acc[node.name] ??= new Set<string>()).add(node.version)
  }
  const out: Record<string, string[]> = {}
  for (const name of Object.keys(acc)) out[name] = [...acc[name]]
  return out
}

/**
 * POST JSON to a registry. SECURITY: the bearer token is attached only over
 * https; redirects are NOT followed (so the token can't be forwarded to another
 * host); the token never appears in thrown errors.
 */
const post = (
  urlStr: string,
  payload: unknown,
  token?: string,
): Promise<any> =>
  new Promise((resolve, reject) => {
    let u: URL
    try {
      u = new URL(urlStr)
    } catch {
      return reject(new Error(`invalid registry url`))
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return reject(new Error(`unsupported registry protocol: ${u.protocol}`))
    }
    const mod = u.protocol === 'https:' ? https : http
    const data = Buffer.from(JSON.stringify(payload))
    const headers: Record<string, string | number> = {
      'content-type': 'application/json',
      'content-length': data.length,
      accept: 'application/json',
    }
    if (token && u.protocol === 'https:') headers.authorization = `Bearer ${token}`

    const req = mod.request(
      u,
      { method: 'POST', headers, timeout: TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (status >= 300) {
            return reject(new Error(`registry ${u.host} responded ${status}`))
          }
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new Error(`registry ${u.host}: invalid JSON response`))
          }
        })
      },
    )
    req.on('error', (e) =>
      reject(new Error(`registry ${u.host}: ${scrub(String(e.message), token)}`)),
    )
    req.on('timeout', () => req.destroy(new Error(`registry ${u.host}: timeout`)))
    req.end(data)
  })

/**
 * GET a package tarball as raw bytes (for `refurbish` checksum recompute).
 * SECURITY: mirrors `post` — the bearer token is attached only over https and
 * only when the tarball is same-origin as the registry that declared it (a
 * CDN-hosted tarball on another host gets no credential); redirects are NOT
 * followed (a 3xx resolves to `undefined`, so the token can't be forwarded);
 * any failure degrades to `undefined` (caller defers to a real `yarn install`).
 */
export const getTarball = (
  tarballUrl: string,
  registryUrl: string,
  token?: string,
): Promise<Uint8Array | undefined> =>
  new Promise((resolve) => {
    let u: URL
    try {
      u = new URL(tarballUrl)
    } catch {
      return resolve(undefined)
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return resolve(undefined)
    const mod = u.protocol === 'https:' ? https : http

    let sameOrigin = false
    try {
      sameOrigin = new URL(registryUrl).host === u.host
    } catch {
      sameOrigin = false
    }
    const headers: Record<string, string> = { accept: 'application/octet-stream' }
    if (token && u.protocol === 'https:' && sameOrigin)
      headers.authorization = `Bearer ${token}`

    const req = mod.request(
      u,
      { method: 'GET', headers, timeout: TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          res.resume() // drain; redirects (3xx) included — deliberately not followed
          return resolve(undefined)
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
      },
    )
    req.on('error', () => resolve(undefined))
    req.on('timeout', () => req.destroy())
    req.end()
  })

/** Intersect two patched ranges (AND); `<0.0.0` "no fix" sentinel wins. */
const joinAnd = (a: string, b: string): string =>
  a === '<0.0.0' || b === '<0.0.0' ? '<0.0.0' : `${a} ${b}`

const fetchAdvisories = async (
  packages: Record<string, string[]>,
  cfg: TRegistryConfig,
): Promise<Record<string, any[]>> => {
  // Group by the registry each package routes to (scope-aware), then chunk.
  const byRegistry = new Map<string, string[]>()
  for (const name of Object.keys(packages)) {
    const reg = cfg.registryFor(name)
    const list = byRegistry.get(reg) ?? []
    list.push(name)
    byRegistry.set(reg, list)
  }

  const raw: Record<string, any[]> = {}
  for (const [registry, names] of byRegistry) {
    const token = cfg.tokenFor(registry)
    const endpoint = registry.replace(/\/+$/, '') + BULK_PATH
    for (let i = 0; i < names.length; i += CHUNK) {
      const body: Record<string, string[]> = {}
      for (const name of names.slice(i, i + CHUNK)) body[name] = packages[name]
      const res = await post(endpoint, body, token)
      if (res && typeof res === 'object') {
        for (const [name, advs] of Object.entries(res)) {
          if (Array.isArray(advs)) (raw[name] ??= []).push(...advs)
        }
      }
    }
  }
  return raw
}

/**
 * The ids a `--ignore` glob can target for one raw advisory. The npm bulk
 * endpoint exposes the numeric `id` and a GHSA `url` (no `cves` field), so —
 * like zx's npm-audit script — we match against the npm id and the GHSA.
 */
const advisoryIds = (a: any): string[] => {
  const ids: string[] = []
  if (a?.id != null) ids.push(String(a.id))
  const ghsa = String(a?.url ?? '').match(/GHSA-[\w-]+/)?.[0]
  if (ghsa) ids.push(ghsa)
  return ids
}

/**
 * Map the bulk-advisory payload into the same TAuditReport `_patch` consumes.
 * `--ignore` globs drop matching advisories (by npm id / CVE / GHSA) before the
 * per-package merge, so ignoring one advisory leaves a package's others intact.
 */
export const toReport = (
  raw: Record<string, any[]>,
  minRank: number,
  ignoreGlobs: RegExp[] = [],
): TAuditReport => {
  const report: TAuditReport = {}
  for (const [name, advs] of Object.entries(raw)) {
    for (const a of advs) {
      const vuln: string | undefined = a?.vulnerable_versions
      if (!vuln) continue
      if (rank(a.severity) < minRank) continue
      if (matchesId(advisoryIds(a), ignoreGlobs)) continue
      const cvss =
        typeof a.cvss === 'number' ? a.cvss : a.cvss?.score || undefined
      const entry = {
        module_name: name,
        vulnerable_versions: vuln,
        patched_versions: derivePatchedVersions(vuln),
        severity: a.severity,
        cvss,
        refs: extractRefs(a.cves, a.url, a.title),
        url: a.url,
      }
      const prev = report[name]
      report[name] = prev
        ? {
            ...entry,
            ...mergeMeta(prev, entry),
            vulnerable_versions: `${prev.vulnerable_versions} || ${vuln}`,
            patched_versions: joinAnd(prev.patched_versions, entry.patched_versions),
          }
        : entry
    }
  }
  return report
}

/**
 * Fetch advisories straight from the registry (npm bulk endpoint) for every
 * package@version in the graph — no `(yarn|npm) audit` spawn. Honours the
 * registry/scope/auth resolved from `.npmrc` / `.yarnrc.yml` / `.yarnrc` + env.
 */
export const auditViaRegistry = async (
  graph: Graph,
  ctx: TContext,
): Promise<TAuditReport> => {
  const cwd = (ctx as any).cwd ?? process.cwd()
  const cfg = resolveRegistryConfig(cwd, ctx.flags)
  const packages = collectPackages(graph)
  if (Object.keys(packages).length === 0) return {}
  const raw = await fetchAdvisories(packages, cfg)
  return toReport(
    raw,
    rank(ctx.flags?.['audit-level']),
    parseIdGlobs(ctx.flags?.ignore),
  )
}
