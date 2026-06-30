import type {
  Ecosystem,
  RegistryAdapter,
  RegistryConfig,
} from '@antongolub/lockfile/registry'
import { liveRegistry, resolveRegistry } from '@antongolub/lockfile/registry'

import { TContext, TLockfileType } from '../ifaces'
import { getTarball } from './registry'

/** What `refurbish` needs to recompute a missing checksum: raw tarball bytes. */
export type TarballSource = {
  tarball: (name: string, version: string) => Promise<Uint8Array | undefined>
}

/**
 * Map a detected lockfile format to the registry-config ecosystem — which fixes
 * exactly which `.npmrc` / `.yarnrc(.yml)` files + env namespace the lib reads, so
 * npm and yarn directives never mix. bun + unknown fall back to npm (it reads
 * `.npmrc`).
 */
export const ecosystemFor = (fmt: TLockfileType): Ecosystem =>
  fmt === 'yarn-classic'
    ? 'yarn-classic'
    : fmt?.startsWith('yarn-berry')
      ? 'yarn-berry'
      : fmt?.startsWith('pnpm')
        ? 'pnpm'
        : 'npm'

// Registry+auth resolved from the project's PM config — the lib owns the parsing
// and the host-bound, https-only auth (`.npmrc`/`.yarnrc.yml`/`.yarnrc`+env).
const registryConfig = (ctx: TContext, ecosystem: Ecosystem): RegistryConfig =>
  resolveRegistry(ctx.cwd ?? process.cwd(), {
    ecosystem,
    registry: ctx.flags?.registry,
  })

// Per-package router: one `liveRegistry` per registry URL (memoized) so a scoped
// graph still resolves each package against its own registry+auth. (The lib's
// `fromConfig` wires a single registry, not enough for a multi-scope graph.)
const pickFor = (cfg: RegistryConfig) => {
  const byUrl = new Map<string, RegistryAdapter>()
  return (name: string): { reg: RegistryAdapter; url: string } => {
    const url = cfg.registryFor(name)
    let reg = byUrl.get(url)
    if (!reg) {
      reg = liveRegistry({ url, authHeader: cfg.authHeaderFor(url) })
      byUrl.set(url, reg)
    }
    return { reg, url }
  }
}

/**
 * A scope-aware `RegistryAdapter` (packument / resolve) for the patch step.
 * Tests / offline runs inject their own adapter via `ctx.registry`.
 */
export const buildRegistry = (
  ctx: TContext,
  ecosystem: Ecosystem,
): RegistryAdapter => {
  if (ctx.registry) return ctx.registry as RegistryAdapter
  const pick = pickFor(registryConfig(ctx, ecosystem))
  return {
    packument: (name) => pick(name).reg.packument(name),
    resolve: (name, range) => pick(name).reg.resolve(name, range),
  }
}

/**
 * A `refurbish` `TarballSource` (raw `.tgz` bytes). Resolves each package to its
 * tarball url via the same scope-aware routing, then fetches the bytes over a
 * redirect-free GET that attaches the host's auth only same-origin + https (see
 * `getTarball`). Tests / offline runs inject their own source via `ctx.tarballSource`.
 */
export const buildTarballSource = (
  ctx: TContext,
  ecosystem: Ecosystem,
): TarballSource => {
  if (ctx.tarballSource) return ctx.tarballSource as TarballSource
  const cfg = registryConfig(ctx, ecosystem)
  const pick = pickFor(cfg)
  return {
    async tarball(name, version) {
      const { reg } = pick(name)
      // `resolve` with an exact version behaves like an exact range → that node.
      const pv = await reg.resolve(name, version)
      if (!pv?.tarball) return undefined
      // Host-bind the auth to the tarball's own host (a CDN tarball → none).
      return getTarball(pv.tarball, cfg.authHeaderFor(pv.tarball), ctx.signal)
    },
  }
}
