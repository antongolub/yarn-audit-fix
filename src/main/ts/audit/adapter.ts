import { type RegistryAdapter, liveRegistry } from '@antongolub/lockfile/registry'

import { TContext } from '../ifaces'
import { resolveRegistryConfig } from './config'
import { getTarball } from './registry'

/** What `refurbish` needs to recompute a missing checksum: raw tarball bytes. */
export type TarballSource = {
  tarball: (name: string, version: string) => Promise<Uint8Array | undefined>
}

/**
 * A `@antongolub/lockfile` `RegistryAdapter` (packument / resolve) for the patch
 * step. Routes each package to the registry + host-bound token resolved from
 * `.npmrc` / `.yarnrc(.yml)` (scope-aware), memoizing one `liveRegistry` per
 * registry URL. Tests / offline runs inject their own adapter via `ctx.registry`.
 */
export const buildRegistry = (ctx: TContext): RegistryAdapter => {
  if (ctx.registry) return ctx.registry as RegistryAdapter

  const cfg = resolveRegistryConfig(ctx.cwd ?? process.cwd(), ctx.flags)
  const byUrl = new Map<string, RegistryAdapter>()
  const pick = (name: string): RegistryAdapter => {
    const url = cfg.registryFor(name)
    let adapter = byUrl.get(url)
    if (!adapter) {
      adapter = liveRegistry({ url, auth: cfg.tokenFor(url) })
      byUrl.set(url, adapter)
    }
    return adapter
  }

  return {
    packument: (name) => pick(name).packument(name),
    resolve: (name, range) => pick(name).resolve(name, range),
  }
}

/**
 * A `refurbish` `TarballSource` (raw npm `.tgz` bytes) for the checksum-fill
 * step. Resolves each package to its tarball url via the same scope-aware,
 * host-bound-auth routing as `buildRegistry`, then fetches the bytes over a
 * redirect-free https GET (see `getTarball`). Tests / offline runs inject their
 * own source via `ctx.tarballSource`.
 */
export const buildTarballSource = (ctx: TContext): TarballSource => {
  if (ctx.tarballSource) return ctx.tarballSource as TarballSource

  const cfg = resolveRegistryConfig(ctx.cwd ?? process.cwd(), ctx.flags)
  const byUrl = new Map<string, RegistryAdapter>()
  const pick = (name: string): { reg: RegistryAdapter; url: string } => {
    const url = cfg.registryFor(name)
    let reg = byUrl.get(url)
    if (!reg) {
      reg = liveRegistry({ url, auth: cfg.tokenFor(url) })
      byUrl.set(url, reg)
    }
    return { reg, url }
  }

  return {
    async tarball(name, version) {
      const { reg, url } = pick(name)
      // `resolve` with an exact version behaves like an exact range → that node.
      const pv = await reg.resolve(name, version)
      if (!pv?.tarball) return undefined
      return getTarball(pv.tarball, url, cfg.tokenFor(url), ctx.signal)
    },
  }
}
