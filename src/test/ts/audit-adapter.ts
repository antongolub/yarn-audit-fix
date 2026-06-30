import { EventEmitter } from 'node:events'
import https from 'node:https'

import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub the lib's registry layer so routing is exercised without network/fs.
vi.mock('@antongolub/lockfile/registry', () => ({
  resolveRegistry: vi.fn(() => ({
    registryFor: () => 'https://reg.example.com',
    authHeaderFor: () => 'Bearer T',
    tokenFor: () => 'T',
  })),
  liveRegistry: vi.fn(() => ({
    packument: async (n: string) => ({ name: n, distTags: { latest: '1.0.0' }, versions: {} }),
    resolve: async (n: string, r: string) => ({
      name: n,
      version: '1.0.0',
      tarball: r === 'withtar' ? 'https://reg.example.com/x/-/x-1.0.0.tgz' : undefined,
    }),
  })),
}))

import { buildRegistry, buildTarballSource, ecosystemFor } from '../../main/ts/audit/adapter'

const ctx = (over: Record<string, any> = {}): any => ({ cwd: '/nonexistent-cfg', flags: {}, ...over })

afterEach(() => vi.restoreAllMocks())

describe('ecosystemFor', () => {
  it('maps lockfile formats to registry ecosystems', () => {
    expect(ecosystemFor('yarn-classic')).toBe('yarn-classic')
    expect(ecosystemFor('yarn-berry-v8')).toBe('yarn-berry')
    expect(ecosystemFor('pnpm-v9')).toBe('pnpm')
    expect(ecosystemFor('npm-3')).toBe('npm')
    expect(ecosystemFor(undefined)).toBe('npm')
  })
})

describe('buildRegistry', () => {
  it('returns the injected ctx.registry verbatim (test seam)', () => {
    const injected = { packument: async () => undefined, resolve: async () => undefined }
    expect(buildRegistry(ctx({ registry: injected }), 'npm')).toBe(injected)
  })

  it('builds a scope-aware adapter routing through liveRegistry', async () => {
    const reg = buildRegistry(ctx(), 'yarn-berry')
    expect((await reg.packument('lodash'))?.name).toBe('lodash')
    expect((await reg.resolve('lodash', '^1.0.0'))?.version).toBe('1.0.0')
  })
})

describe('buildTarballSource', () => {
  it('returns the injected ctx.tarballSource verbatim (test seam)', () => {
    const injected = { tarball: async () => undefined }
    expect(buildTarballSource(ctx({ tarballSource: injected }), 'npm')).toBe(injected)
  })

  it('returns undefined when the package resolves without a tarball url', async () => {
    expect(await buildTarballSource(ctx(), 'yarn-berry').tarball('x', '1.0.0')).toBeUndefined()
  })

  it('fetches tarball bytes when a url resolves', async () => {
    vi.spyOn(https, 'request').mockImplementation((_u: any, _o: any, cb: any): any => {
      const req: any = new EventEmitter()
      req.destroy = () => undefined
      req.end = () =>
        process.nextTick(() => {
          const res: any = new EventEmitter()
          res.statusCode = 200
          res.resume = () => undefined
          cb(res)
          process.nextTick(() => {
            res.emit('data', Buffer.from([7]))
            res.emit('end')
          })
        })
      return req
    })
    expect([...((await buildTarballSource(ctx(), 'yarn-berry').tarball('x', 'withtar')) ?? [])]).toEqual([7])
  })
})
