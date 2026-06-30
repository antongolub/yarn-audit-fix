import { EventEmitter } from 'node:events'
import http from 'node:http'
import https from 'node:https'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { auditViaRegistry, getTarball, toReport } from '../../main/ts/audit/registry'
import { audit, getLockfileType, parse } from '../../main/ts/lockfile'
import { TContext } from '../../main/ts/ifaces'

// getTarball uses node:http/https (the lib returns urls, not bytes) → stub both.
type Stub = { status?: number; body?: Buffer; error?: Error; onReq?: (o: any) => void }
const stubReq = (stub: Stub) => {
  const impl = (url: any, opts: any, cb: any): any => {
    stub.onReq?.({ url, opts })
    const req: any = new EventEmitter()
    req.destroy = (e?: Error) => e && req.emit('error', e)
    req.end = () =>
      process.nextTick(() => {
        if (stub.error) return req.emit('error', stub.error)
        const res: any = new EventEmitter()
        res.statusCode = stub.status ?? 200
        res.resume = () => undefined
        cb(res)
        process.nextTick(() => {
          if (stub.body != null) res.emit('data', stub.body)
          res.emit('end')
        })
      })
    return req
  }
  vi.spyOn(https, 'request').mockImplementation(impl as any)
  vi.spyOn(http, 'request').mockImplementation(impl as any)
  return impl
}

// auditViaRegistry calls the lib's liveRegistry.audit via `ctx.fetch` (the test
// seam → opts.fetch on the adapter), so the audit stays offline + deterministic.
const fetchReturning = (json: any, ok = true, status = 200): any =>
  async () => ({ ok, status, json: async () => json })

// Real registry.npmjs.org `resolved` urls so the node has no `source`
// discriminator and the lib's `registryPackages` includes it.
const lock = (entries: { id: string; version: string }[]): string =>
  '# yarn lockfile v1\n\n\n' +
  entries
    .map((e) => {
      const name = e.id.slice(0, e.id.lastIndexOf('@'))
      const file = name.replace(/^@[^/]+\//, '')
      return `"${e.id}":\n  version "${e.version}"\n  resolved "https://registry.npmjs.org/${name}/-/${file}-${e.version}.tgz#h"\n  integrity sha512-${'A'.repeat(86)}==`
    })
    .join('\n\n') +
  '\n'

const graphOf = (entries: { id: string; version: string }[]) => {
  const text = lock(entries)
  return parse(text, getLockfileType(text))
}

const ctx = (over: Record<string, any> = {}): TContext =>
  ({ cwd: '/nope', flags: {}, ...over }) as unknown as TContext

afterEach(() => vi.restoreAllMocks())

describe('toReport', () => {
  const adv = (over: Record<string, any> = {}) => ({
    id: 1,
    vulnerable_versions: '<4.17.21',
    severity: 'high',
    url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    ...over,
  })

  it('derives patched_versions and keeps cvss (number or {score})', () => {
    expect(toReport({ lodash: [adv({ cvss: 7.5 })] }, 0).lodash.patched_versions).toBe('>=4.17.21')
    expect(toReport({ a: [adv({ cvss: 7.5 })] }, 0).a.cvss).toBe(7.5)
    expect(toReport({ a: [adv({ cvss: { score: 9.1 } })] }, 0).a.cvss).toBe(9.1)
  })

  it('filters below the min severity rank', () => {
    expect(toReport({ a: [adv({ severity: 'low' })] }, 3)).toEqual({})
    expect(Object.keys(toReport({ a: [adv({ severity: 'critical' })] }, 3))).toEqual(['a'])
  })

  it('drops advisories matched by --ignore (npm id or GHSA)', () => {
    expect(toReport({ a: [adv({ id: 1234 })] }, 0, [/^1234$/])).toEqual({})
    expect(toReport({ a: [adv()] }, 0, [/GHSA-aaaa-bbbb-cccc/])).toEqual({})
  })

  it('merges multiple advisories per package (OR vuln, AND patched)', () => {
    const r = toReport(
      { a: [adv({ vulnerable_versions: '<1.0.0' }), adv({ vulnerable_versions: '<2.0.0' })] },
      0,
    )
    expect(r.a.vulnerable_versions).toBe('<1.0.0 || <2.0.0')
    expect(r.a.patched_versions).toBe('>=1.0.0 >=2.0.0')
  })

  it('skips entries without vulnerable_versions', () => {
    expect(toReport({ a: [{ id: 9, severity: 'high' }] }, 0)).toEqual({})
  })
})

describe('getTarball', () => {
  const TGZ = 'https://registry.npmjs.org/lodash/-/lodash-1.0.0.tgz'

  it('returns bytes on 200, undefined on 3xx/404/error/non-http/bad-url', async () => {
    stubReq({ status: 200, body: Buffer.from([1, 2, 3]) })
    expect([...((await getTarball(TGZ)) ?? [])]).toEqual([1, 2, 3])
    stubReq({ status: 302 })
    expect(await getTarball(TGZ)).toBeUndefined()
    stubReq({ status: 404 })
    expect(await getTarball(TGZ)).toBeUndefined()
    stubReq({ error: new Error('ECONNRESET') })
    expect(await getTarball(TGZ)).toBeUndefined()
    expect(await getTarball('ftp://x/y.tgz')).toBeUndefined()
    expect(await getTarball('not a url')).toBeUndefined()
  })

  it('sends the (caller host-bound) auth header over https, never over http', async () => {
    let h: any
    stubReq({ status: 200, body: Buffer.from([0]), onReq: ({ opts }) => (h = opts.headers) })
    await getTarball(TGZ, 'Bearer SECRET')
    expect(h.authorization).toBe('Bearer SECRET')

    let h2: any
    stubReq({ status: 200, body: Buffer.from([0]), onReq: ({ opts }) => (h2 = opts.headers) })
    await getTarball('http://reg.npmjs.org/x.tgz', 'Bearer SECRET') // http → no auth
    expect(h2.authorization).toBeUndefined()
  })

  it('short-circuits to undefined when already aborted', async () => {
    const c = new AbortController()
    c.abort()
    const spy = vi.spyOn(https, 'request')
    expect(await getTarball(TGZ, undefined, c.signal)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('auditViaRegistry', () => {
  const HIGH = { lodash: [{ id: 1, vulnerable_versions: '<4.17.21', severity: 'high' }] }
  const g = () => graphOf([{ id: 'lodash@^4.0.0', version: '4.17.20' }])

  it('returns {} for an empty graph without any request', async () => {
    let called = false
    const fetch: any = async () => ((called = true), { ok: true, json: async () => ({}) })
    expect(await auditViaRegistry({ nodes: () => [] } as any, ctx({ fetch }), 'yarn-classic')).toEqual({})
    expect(called).toBe(false)
  })

  it('POSTs the bulk endpoint and maps the response to a report', async () => {
    let reqUrl = ''
    const fetch: any = async (url: any) => ((reqUrl = String(url)), { ok: true, json: async () => HIGH })
    const r = await auditViaRegistry(g(), ctx({ fetch }), 'yarn-classic')
    expect(reqUrl).toContain('/-/npm/v1/security/advisories/bulk')
    expect(r.lodash.patched_versions).toBe('>=4.17.21')
  })

  it('rejects when the registry responds with an error status', async () => {
    await expect(
      auditViaRegistry(g(), ctx({ fetch: fetchReturning({}, false, 500) }), 'yarn-classic'),
    ).rejects.toThrow(/audit: 500/)
  })

  it('respects --audit-level (filters low-severity advisories)', async () => {
    const fetch = fetchReturning({
      lodash: [{ id: 1, vulnerable_versions: '<4.17.21', severity: 'low' }],
    })
    const r = await auditViaRegistry(g(), ctx({ flags: { 'audit-level': 'high' }, fetch }), 'yarn-classic')
    expect(r).toEqual({})
  })

  it('lockfile.audit() delegates (maps lockfileType → ecosystem)', async () => {
    const r = await audit(g(), ctx({ fetch: fetchReturning(HIGH) }), 'yarn-classic')
    expect(r.lodash.patched_versions).toBe('>=4.17.21')
  })
})
