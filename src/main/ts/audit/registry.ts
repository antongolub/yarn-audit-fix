import http from 'node:http'
import https from 'node:https'

import type { Graph } from '@antongolub/lockfile'
import type { Ecosystem } from '@antongolub/lockfile/registry'
import { liveRegistry, resolveRegistry } from '@antongolub/lockfile/registry'
import { registryPackages } from '@antongolub/lockfile/optimize'

import { TAuditReport, TContext } from '../ifaces'
import { matchesId, parseIdGlobs } from './filter'
import { derivePatchedVersions, extractRefs, mergeMeta } from './meta'

const TIMEOUT_MS = 30_000

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
}
const rank = (s?: string): number => SEVERITY_RANK[String(s ?? 'info')] ?? 0

/**
 * GET a package tarball as raw bytes (for `refurbish` checksum recompute) — the
 * one registry fetch the lib's adapter doesn't do (it returns urls, not bytes).
 * SECURITY: `authHeader` is host-bound by the caller (`authHeaderFor(tarballUrl)`
 * returns nothing for an un-declared host, so a CDN tarball on another host gets no
 * credential — that IS the same-origin guard) and only sent over https; redirects
 * are NOT followed (a 3xx resolves to `undefined`); any failure degrades to
 * `undefined` (caller defers to `yarn install`).
 */
export const getTarball = (
  tarballUrl: string,
  authHeader?: string,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve(undefined) // cancelling — skip the fetch
    let u: URL
    try {
      u = new URL(tarballUrl)
    } catch {
      return resolve(undefined)
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return resolve(undefined)
    const mod = u.protocol === 'https:' ? https : http

    const headers: Record<string, string> = { accept: 'application/octet-stream' }
    // Host-binding is the caller's job; here just never send auth over http.
    if (authHeader && u.protocol === 'https:') headers.authorization = authHeader

    const req = mod.request(
      u,
      { method: 'GET', headers, timeout: TIMEOUT_MS },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          res.resume() // drain; redirects (3xx) included — deliberately not followed
          cleanup()
          return resolve(undefined)
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          cleanup()
          resolve(new Uint8Array(Buffer.concat(chunks)))
        })
      },
    )
    const onAbort = () => req.destroy()
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort)
    signal?.addEventListener?.('abort', onAbort, { once: true })
    req.on('error', () => {
      cleanup()
      resolve(undefined)
    })
    req.on('timeout', () => req.destroy())
    req.end()
  })

/** Intersect two patched ranges (AND); `<0.0.0` "no fix" sentinel wins. */
const joinAnd = (a: string, b: string): string =>
  a === '<0.0.0' || b === '<0.0.0' ? '<0.0.0' : `${a} ${b}`

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
 * Map the raw bulk-advisory payload into the TAuditReport `_patch` consumes (the
 * lib's `audit()` does zero normalization). `--ignore` globs drop matching
 * advisories (npm id / GHSA) before the per-package merge; below-`--audit-level`
 * severities are filtered.
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
 * package@version in the graph — no `(yarn|npm) audit` spawn. The lib owns the
 * package list (`registryPackages`, locator-aware), the registry/scope/auth
 * resolution + the bulk POST (`liveRegistry.audit`, host-bound https auth);
 * advisory→report normalisation stays here. Packages are grouped by their routed
 * registry so a scoped graph audits each registry with its own credential.
 */
export const auditViaRegistry = async (
  graph: Graph,
  ctx: TContext,
  ecosystem: Ecosystem,
): Promise<TAuditReport> => {
  const packages = registryPackages(graph)
  if (Object.keys(packages).length === 0) return {}

  const cfg = resolveRegistry(ctx.cwd ?? process.cwd(), {
    ecosystem,
    registry: ctx.flags?.registry,
  })
  const byUrl = new Map<string, string[]>()
  for (const name of Object.keys(packages)) {
    const url = cfg.registryFor(name)
    const list = byUrl.get(url) ?? []
    list.push(name)
    byUrl.set(url, list)
  }

  ctx.progress?.label('Fetching advisories…')
  // The lib's `liveRegistry` fetches via node-fetch-native — so audit works below
  // Node 18, no global-`fetch` dependency. `ctx.fetch` is the test seam only (the
  // lib uses `opts.fetch ?? fetch`); a Ctrl+C unwinds via the run's force-exit,
  // since neither the lib's audit POST nor completion threads an AbortSignal.
  const fetchImpl = ctx.fetch

  const raw: Record<string, any[]> = {}
  for (const [url, names] of byUrl) {
    const reg = liveRegistry({
      url,
      authHeader: cfg.authHeaderFor(url),
      fetch: fetchImpl,
    })
    const slice: Record<string, string[]> = {}
    for (const name of names) slice[name] = packages[name]
    const res = await reg.audit(slice)
    for (const [name, advs] of Object.entries(res)) (raw[name] ??= []).push(...advs)
  }

  return toReport(
    raw,
    rank(ctx.flags?.['audit-level']),
    parseIdGlobs(ctx.flags?.ignore),
  )
}
